package session

import (
	"encoding/json"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
)

func (m *Manager) StartPendingChatCommandRun(
	requestID string,
	conversationID string,
	clientRequestID string,
	workdirInput ...string,
) (ChatRunSnapshot, bool, error) {
	return m.startPendingChatCommandRun(requestID, conversationID, clientRequestID, workdirInput...)
}

func (m *Manager) StartAcceptedChatCommandRun(
	requestID string,
	conversationID string,
	clientRequestID string,
	workdir string,
	initialPayloads []map[string]any,
) (ChatRunSnapshot, bool, int64, error) {
	m.chatStore.chatCommandMu.Lock()
	defer m.chatStore.chatCommandMu.Unlock()

	snapshot, created, err := m.startPendingChatCommandRun(
		requestID,
		conversationID,
		clientRequestID,
		workdir,
	)
	if err != nil || !created {
		return snapshot, created, snapshot.LatestSeq, err
	}

	m.MarkChatRunControl(snapshot.RequestID, conversationID, "accepted", "", "")
	acceptedSeq := snapshot.LatestSeq
	if acceptedSnapshot, ok := m.ChatRunSnapshot(snapshot.RequestID, conversationID); ok {
		snapshot = acceptedSnapshot
		acceptedSeq = acceptedSnapshot.LatestSeq
	}
	if len(initialPayloads) > 0 {
		m.MarkChatRunPayloads(snapshot.RequestID, conversationID, initialPayloads)
		if nextSnapshot, ok := m.ChatRunSnapshot(snapshot.RequestID, conversationID); ok {
			snapshot = nextSnapshot
		}
	}
	return snapshot, true, acceptedSeq, nil
}

func (m *Manager) startPendingChatCommandRun(
	requestID string,
	conversationID string,
	clientRequestID string,
	workdirInput ...string,
) (ChatRunSnapshot, bool, error) {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return ChatRunSnapshot{}, false, ErrChatRunNotFound
	}

	now := time.Now()
	conversationID = strings.TrimSpace(conversationID)
	clientRequestID = strings.TrimSpace(clientRequestID)
	workdir := ""
	if len(workdirInput) > 0 {
		workdir = strings.TrimSpace(workdirInput[0])
	}
	sessionEpoch := m.currentSessionEpoch()
	if store := m.chatStore.eventStore; store != nil {
		snapshot, created, err := store.StartRun(ChatRunStoreStart{
			RequestID:       requestID,
			ConversationID:  conversationID,
			ClientRequestID: clientRequestID,
			Workdir:         workdir,
			CreatedAt:       now,
		})
		if err != nil {
			return ChatRunSnapshot{}, false, err
		}
		m.chatStore.chatMu.Lock()
		defer m.chatStore.chatMu.Unlock()
		m.pruneExpiredChatRunsLocked(now)
		if created {
			if latestSeq := m.latestConversationSeqLocked(conversationID); latestSeq > snapshot.LatestSeq {
				snapshot.LatestSeq = latestSeq
			}
		}
		run := m.upsertChatRunSnapshotLocked(snapshot, sessionEpoch, now)
		if run == nil {
			return snapshot, created, nil
		}
		return run.snapshot(), created, nil
	}

	m.chatStore.chatMu.Lock()
	defer m.chatStore.chatMu.Unlock()
	m.pruneExpiredChatRunsLocked(now)

	if clientRequestID != "" {
		if existingRequestID := m.chatStore.chatRunByClientRequest[clientRequestID]; existingRequestID != "" {
			if existing := m.chatStore.chatRuns[existingRequestID]; existing != nil {
				if !existing.done {
					if workdir != "" && existing.workdir == "" {
						existing.workdir = workdir
					}
					return existing.snapshot(), false, nil
				}
				m.releaseCompletedChatRunLocked(existingRequestID, existing)
			}
			delete(m.chatStore.chatRunByClientRequest, clientRequestID)
		}
	}

	if existing := m.chatStore.chatRuns[requestID]; existing != nil {
		m.removeChatRunLocked(requestID, existing)
	}

	m.chatStore.nextChatRunEpoch += 1
	latestSeq := m.latestConversationSeqLocked(conversationID)
	run := &chatRun{
		requestID:       requestID,
		conversationID:  conversationID,
		clientRequestID: clientRequestID,
		workdir:         workdir,
		sessionEpoch:    sessionEpoch,
		runEpoch:        m.chatStore.nextChatRunEpoch,
		state:           ChatRunStateQueued,
		nextSeq:         latestSeq,
		updatedAt:       now,
		subscribers:     make(map[int]*chatRunSubscriber),
	}
	run.applyState(ChatRunStateQueued)
	m.chatStore.chatRuns[requestID] = run
	if conversationID != "" && m.chatRunCanClaimConversationLocked(conversationID, requestID) {
		m.chatStore.chatRunByConversation[conversationID] = requestID
	}
	if clientRequestID != "" {
		m.chatStore.chatRunByClientRequest[clientRequestID] = requestID
	}

	return run.snapshot(), true, nil
}

func (m *Manager) latestConversationSeqLocked(conversationID string) int64 {
	if conversationID == "" {
		return 0
	}
	var latestSeq int64
	for _, run := range m.chatStore.chatRuns {
		if run == nil || run.conversationID != conversationID {
			continue
		}
		if run.nextSeq > latestSeq {
			latestSeq = run.nextSeq
		}
	}
	return latestSeq
}

func (m *Manager) chatRunCanClaimConversationLocked(conversationID string, requestID string) bool {
	if conversationID == "" || requestID == "" {
		return false
	}
	currentRequestID := m.chatStore.chatRunByConversation[conversationID]
	if currentRequestID == "" || currentRequestID == requestID {
		return true
	}
	currentRun := m.chatStore.chatRuns[currentRequestID]
	return currentRun == nil || currentRun.done
}

func chatRunControlCanClaimConversation(controlType string, state string) bool {
	if normalizeChatRunState(state) == ChatRunStateRunning {
		return true
	}
	return controlType == "started"
}

func (m *Manager) upsertChatRunSnapshotLocked(
	snapshot ChatRunSnapshot,
	sessionEpoch uint64,
	now time.Time,
) *chatRun {
	requestID := strings.TrimSpace(snapshot.RequestID)
	if requestID == "" {
		return nil
	}
	if existing := m.chatStore.chatRuns[requestID]; existing != nil {
		m.applyChatRunSnapshotLocked(existing, snapshot, now)
		return existing
	}
	if snapshot.RunEpoch > m.chatStore.nextChatRunEpoch {
		m.chatStore.nextChatRunEpoch = snapshot.RunEpoch
	}
	run := &chatRun{
		requestID:       requestID,
		conversationID:  strings.TrimSpace(snapshot.ConversationID),
		clientRequestID: strings.TrimSpace(snapshot.ClientRequestID),
		workdir:         strings.TrimSpace(snapshot.Workdir),
		sessionEpoch:    sessionEpoch,
		runEpoch:        snapshot.RunEpoch,
		state:           normalizeChatRunState(snapshot.State),
		errorCode:       strings.TrimSpace(snapshot.ErrorCode),
		nextSeq:         snapshot.LatestSeq,
		updatedAt:       now,
		subscribers:     make(map[int]*chatRunSubscriber),
	}
	if run.runEpoch <= 0 {
		m.chatStore.nextChatRunEpoch += 1
		run.runEpoch = m.chatStore.nextChatRunEpoch
	}
	run.applyState(run.state)
	if snapshot.Done {
		run.applyState(ChatRunStateCompleted)
		if snapshot.State == ChatRunStateFailed {
			run.applyState(ChatRunStateFailed)
			run.errorCode = strings.TrimSpace(snapshot.ErrorCode)
		} else if snapshot.State == ChatRunStateCancelled {
			run.applyState(ChatRunStateCancelled)
		}
	}
	m.chatStore.chatRuns[requestID] = run
	if run.conversationID != "" && m.chatRunCanClaimConversationLocked(run.conversationID, requestID) {
		m.chatStore.chatRunByConversation[run.conversationID] = requestID
	}
	if run.clientRequestID != "" {
		m.chatStore.chatRunByClientRequest[run.clientRequestID] = requestID
	}
	return run
}

func (m *Manager) applyChatRunSnapshotLocked(run *chatRun, snapshot ChatRunSnapshot, now time.Time) {
	if run == nil {
		return
	}
	requestID := strings.TrimSpace(snapshot.RequestID)
	if requestID == "" {
		requestID = run.requestID
	}
	conversationID := strings.TrimSpace(snapshot.ConversationID)
	m.updateRunConversationLocked(run, requestID, conversationID, false)
	if clientRequestID := strings.TrimSpace(snapshot.ClientRequestID); clientRequestID != "" {
		run.clientRequestID = clientRequestID
		m.chatStore.chatRunByClientRequest[clientRequestID] = requestID
	}
	if workdir := strings.TrimSpace(snapshot.Workdir); workdir != "" {
		run.workdir = workdir
	}
	if snapshot.RunEpoch > 0 {
		run.runEpoch = snapshot.RunEpoch
		if snapshot.RunEpoch > m.chatStore.nextChatRunEpoch {
			m.chatStore.nextChatRunEpoch = snapshot.RunEpoch
		}
	}
	if snapshot.LatestSeq > run.nextSeq {
		run.nextSeq = snapshot.LatestSeq
	}
	if state := normalizeChatRunState(snapshot.State); state != "" {
		run.applyState(state)
	}
	if snapshot.Done && !run.done {
		run.applyState(ChatRunStateCompleted)
	}
	if snapshot.ErrorCode != "" {
		run.errorCode = strings.TrimSpace(snapshot.ErrorCode)
	}
	run.updatedAt = now
}

func (m *Manager) RemoveChatRun(requestID string) {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return
	}

	m.chatStore.chatMu.Lock()
	defer m.chatStore.chatMu.Unlock()
	run := m.chatStore.chatRuns[requestID]
	if run == nil {
		return
	}
	m.removeChatRunLocked(requestID, run)
}

func (m *Manager) RemoveChatRunByConversation(conversationID string) {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return
	}

	m.chatStore.chatMu.Lock()
	defer m.chatStore.chatMu.Unlock()
	requestID := m.chatStore.chatRunByConversation[conversationID]
	run := m.chatStore.chatRuns[requestID]
	if run == nil {
		for candidateRequestID, candidateRun := range m.chatStore.chatRuns {
			if candidateRun.conversationID == conversationID {
				requestID = candidateRequestID
				run = candidateRun
				break
			}
		}
	}
	if run == nil {
		return
	}
	m.removeChatRunLocked(requestID, run)
}

func (m *Manager) ActiveChatRunSummaries() []ActiveChatRunSummary {
	m.chatStore.chatMu.Lock()
	defer m.chatStore.chatMu.Unlock()
	now := time.Now()
	m.pruneExpiredChatRunsLocked(now)

	seen := make(map[string]int, len(m.chatStore.chatRuns))
	summaries := make([]ActiveChatRunSummary, 0, len(m.chatStore.chatRuns))
	for _, run := range m.chatStore.chatRuns {
		if run == nil || run.done || !activeChatRunStates[run.state] {
			continue
		}
		conversationID := run.conversationID
		if conversationID == "" {
			continue
		}
		firstSeq := run.snapshot().FirstSeq
		if firstSeq <= 0 {
			firstSeq = run.nextSeq + 1
		}
		summary := ActiveChatRunSummary{
			ConversationID: conversationID,
			RequestID:      run.requestID,
			Workdir:        run.workdir,
			FirstSeq:       firstSeq,
			LatestSeq:      run.nextSeq,
			RunEpoch:       run.runEpoch,
			UpdatedAt:      run.updatedAt.UnixMilli(),
		}
		if index, ok := seen[conversationID]; ok {
			if summaries[index].Workdir == "" {
				summaries[index].Workdir = summary.Workdir
			}
			currentOwner := m.chatStore.chatRunByConversation[conversationID]
			if shouldReplaceActiveChatRunSummary(summary, summaries[index], currentOwner) {
				summaries[index].RequestID = summary.RequestID
				summaries[index].FirstSeq = summary.FirstSeq
				summaries[index].LatestSeq = summary.LatestSeq
				summaries[index].RunEpoch = summary.RunEpoch
				summaries[index].UpdatedAt = summary.UpdatedAt
			}
			continue
		}
		seen[conversationID] = len(summaries)
		summaries = append(summaries, summary)
	}

	sort.Slice(summaries, func(i, j int) bool {
		return summaries[i].ConversationID < summaries[j].ConversationID
	})
	return summaries
}

func shouldReplaceActiveChatRunSummary(candidate ActiveChatRunSummary, current ActiveChatRunSummary, currentOwner string) bool {
	candidateIsOwner := currentOwner != "" && candidate.RequestID == currentOwner
	currentIsOwner := currentOwner != "" && current.RequestID == currentOwner
	if candidateIsOwner != currentIsOwner {
		return candidateIsOwner
	}
	return candidate.UpdatedAt > current.UpdatedAt
}

func (m *Manager) ConversationRunSummary(conversationID string) (ActiveChatRunSummary, bool) {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return ActiveChatRunSummary{}, false
	}
	m.chatStore.chatMu.Lock()
	defer m.chatStore.chatMu.Unlock()
	requestID := m.chatStore.chatRunByConversation[conversationID]
	if requestID == "" {
		return ActiveChatRunSummary{}, false
	}
	run := m.chatStore.chatRuns[requestID]
	if run == nil {
		return ActiveChatRunSummary{}, false
	}
	firstSeq := run.snapshot().FirstSeq
	if firstSeq <= 0 {
		firstSeq = run.nextSeq + 1
	}
	return ActiveChatRunSummary{
		ConversationID: conversationID,
		RequestID:      run.requestID,
		Workdir:        run.workdir,
		FirstSeq:       firstSeq,
		LatestSeq:      run.nextSeq,
		RunEpoch:       run.runEpoch,
		UpdatedAt:      run.updatedAt.UnixMilli(),
	}, true
}

func (m *Manager) FailStartingChatRun(requestID string, message string) bool {
	failed, sessionEpoch := m.failChatRunIf(
		requestID,
		message,
		"Desktop backend did not accept the remote chat request. Please retry.",
		func(run *chatRun) bool {
			if run == nil || run.done {
				return false
			}
			state := normalizeChatRunState(run.state)
			return state == ChatRunStateQueued
		},
	)
	if failed {
		m.clearSessionForEpoch(sessionEpoch)
	}
	return failed
}

func (m *Manager) FailUnstartedChatRun(requestID string, message string) bool {
	failed, _ := m.failChatRunIf(
		requestID,
		message,
		"Desktop app accepted the remote chat request but did not start it. Please retry.",
		func(run *chatRun) bool {
			if run == nil || run.done {
				return false
			}
			state := normalizeChatRunState(run.state)
			return state != ChatRunStateQueued &&
				state != ChatRunStateDesktopQueued &&
				state != ChatRunStateRunning &&
				!isTerminalChatRunState(state)
		},
	)
	return failed
}

func (m *Manager) failChatRunIf(
	requestID string,
	message string,
	defaultMessage string,
	shouldFail func(*chatRun) bool,
) (bool, uint64) {
	requestID = strings.TrimSpace(requestID)
	message = strings.TrimSpace(message)
	if requestID == "" {
		return false, 0
	}
	if message == "" {
		message = defaultMessage
	}

	data, err := json.Marshal(map[string]string{"message": message})
	if err != nil {
		fallback, marshalErr := json.Marshal(map[string]string{"message": defaultMessage})
		if marshalErr != nil {
			fallback = []byte(`{"message":"Remote chat request failed. Please retry."}`)
		}
		data = fallback
	}

	now := time.Now()
	var broadcast *ChatBroadcastEvent
	var persist ChatRunEventAppend
	var runSubscribers []*chatRunSubscriber

	m.chatStore.chatMu.Lock()
	m.pruneExpiredChatRunsLocked(now)
	run := m.chatStore.chatRuns[requestID]
	if shouldFail == nil || !shouldFail(run) {
		m.chatStore.chatMu.Unlock()
		return false, 0
	}
	sessionEpoch := run.sessionEpoch

	run.nextSeq += 1
	run.updatedAt = now
	run.applyState(ChatRunStateFailed)
	run.errorCode = "desktop_runtime_unavailable"
	run.expiresAt = now.Add(chatRunDoneRetention)
	chatEvent := &gatewayv1.ChatEvent{
		Type:           gatewayv1.ChatEvent_ERROR,
		ConversationId: run.conversationID,
		Data:           string(data),
	}
	broadcast = &ChatBroadcastEvent{
		RequestID: requestID,
		Event:     chatEvent,
		Seq:       run.nextSeq,
		Workdir:   run.workdir,
	}
	run.appendEvent(broadcast)
	persist = chatRunEventAppendSnapshot(run, broadcast, now)
	runSubscribers = run.collectSubscribers()
	m.chatStore.chatMu.Unlock()

	m.persistChatBroadcast(persist)
	notifySubscribers(runSubscribers, broadcast)
	return true, sessionEpoch
}

func (m *Manager) SubscribeChatRun(
	requestID string,
	conversationID string,
	afterSeq int64,
) (<-chan *ChatBroadcastEvent, <-chan struct{}, func(), ChatRunSnapshot, error) {
	requestID = strings.TrimSpace(requestID)
	conversationID = strings.TrimSpace(conversationID)
	if afterSeq < 0 {
		afterSeq = 0
	}
	conversationReplayRequested := requestID == "" && conversationID != ""

	var persistedReplay []*ChatBroadcastEvent
	var persistedSnapshot ChatRunSnapshot
	persistedFound := false
	if store := m.chatStore.eventStore; store != nil {
		snapshot, replay, ok, err := store.Replay(requestID, conversationID, afterSeq, maxBufferedChatRunEvents)
		if err != nil {
			done := make(chan struct{})
			close(done)
			return nil, done, func() {}, ChatRunSnapshot{}, err
		}
		if ok {
			persistedFound = true
			persistedSnapshot = snapshot
			persistedReplay = replay
			requestID = strings.TrimSpace(snapshot.RequestID)
			if conversationID == "" {
				conversationID = strings.TrimSpace(snapshot.ConversationID)
			}
		}
	}

	m.chatStore.chatMu.Lock()
	defer m.chatStore.chatMu.Unlock()
	now := time.Now()
	m.pruneExpiredChatRunsLocked(now)

	if conversationReplayRequested && conversationID != "" {
		if liveRequestID := m.chatStore.chatRunByConversation[conversationID]; liveRequestID != "" {
			requestID = liveRequestID
		}
	} else if requestID == "" && conversationID != "" {
		requestID = m.chatStore.chatRunByConversation[conversationID]
	}
	run := m.chatStore.chatRuns[requestID]
	if run == nil && persistedFound {
		run = m.upsertChatRunSnapshotLocked(persistedSnapshot, m.currentSessionEpoch(), now)
		if run != nil {
			for _, event := range persistedReplay {
				if event.RequestID == run.requestID {
					run.appendEvent(event)
				}
			}
		}
	} else if run != nil && persistedFound && run.requestID == persistedSnapshot.RequestID {
		m.applyChatRunSnapshotLocked(run, persistedSnapshot, now)
	}
	if run == nil {
		done := make(chan struct{})
		close(done)
		return nil, done, func() {}, ChatRunSnapshot{}, ErrChatRunNotFound
	}

	replay := make([]*ChatBroadcastEvent, 0)
	var buffered []*ChatBroadcastEvent
	if conversationReplayRequested && conversationID != "" {
		buffered = m.collectConversationEventsLocked(conversationID, afterSeq)
	} else {
		buffered = collectBufferedEventsAfterSeq(run, afterSeq)
	}
	if persistedFound {
		for _, event := range persistedReplay {
			replay = append(replay, cloneChatBroadcastEvent(event))
		}
		replay = mergeChatReplayEvents(replay, buffered)
	} else {
		replay = buffered
	}

	bufferSize := len(replay) + 128
	if bufferSize < 128 {
		bufferSize = 128
	}
	ch := make(chan *ChatBroadcastEvent, bufferSize)
	done := make(chan struct{})
	for _, event := range replay {
		ch <- event
	}

	subID := -1
	var subscriber *chatRunSubscriber
	doneClosed := false
	if !run.done {
		subID = m.chatStore.nextChatRunSubID
		m.chatStore.nextChatRunSubID += 1
		subscriber = &chatRunSubscriber{
			ch:   ch,
			done: done,
		}
		run.subscribers[subID] = subscriber
	} else if len(replay) == 0 {
		close(done)
		doneClosed = true
	}

	var cleanupOnce sync.Once
	cleanup := func() {
		cleanupOnce.Do(func() {
			m.chatStore.chatMu.Lock()
			if subID >= 0 {
				if current := m.chatStore.chatRuns[requestID]; current != nil {
					delete(current.subscribers, subID)
				}
			}
			m.chatStore.chatMu.Unlock()
			if subscriber != nil {
				subscriber.close()
			} else if !doneClosed {
				close(done)
			}
		})
	}

	return ch, done, cleanup, run.snapshot(), nil
}

func collectBufferedEventsAfterSeq(run *chatRun, afterSeq int64) []*ChatBroadcastEvent {
	if run == nil {
		return nil
	}
	replay := make([]*ChatBroadcastEvent, 0, len(run.events))
	for _, event := range run.events {
		if event.Seq > afterSeq {
			replay = append(replay, cloneChatBroadcastEvent(event))
		}
	}
	return replay
}

func (m *Manager) collectConversationEventsLocked(conversationID string, afterSeq int64) []*ChatBroadcastEvent {
	var replay []*ChatBroadcastEvent
	for _, run := range m.chatStore.chatRuns {
		if run == nil || run.conversationID != conversationID {
			continue
		}
		for _, event := range run.events {
			if event.Seq > afterSeq {
				replay = append(replay, cloneChatBroadcastEvent(event))
			}
		}
	}
	return replay
}

func mergeChatReplayEvents(
	persisted []*ChatBroadcastEvent,
	buffered []*ChatBroadcastEvent,
) []*ChatBroadcastEvent {
	if len(persisted) == 0 {
		return buffered
	}
	if len(buffered) == 0 {
		return persisted
	}
	seen := make(map[int64]struct{}, len(persisted))
	for _, e := range persisted {
		if e != nil && e.Seq > 0 {
			seen[e.Seq] = struct{}{}
		}
	}
	merged := make([]*ChatBroadcastEvent, 0, len(persisted)+len(buffered))
	merged = append(merged, persisted...)
	for _, e := range buffered {
		if e != nil && e.Seq > 0 {
			if _, dup := seen[e.Seq]; !dup {
				merged = append(merged, cloneChatBroadcastEvent(e))
			}
		}
	}
	sort.SliceStable(merged, func(i, j int) bool {
		return merged[i].Seq < merged[j].Seq
	})
	return merged
}

func (m *Manager) ChatRunSnapshot(
	requestID string,
	conversationID string,
) (ChatRunSnapshot, bool) {
	requestID = strings.TrimSpace(requestID)
	conversationID = strings.TrimSpace(conversationID)

	m.chatStore.chatMu.Lock()
	defer m.chatStore.chatMu.Unlock()
	m.pruneExpiredChatRunsLocked(time.Now())

	if requestID == "" && conversationID != "" {
		requestID = m.chatStore.chatRunByConversation[conversationID]
	}
	run := m.chatStore.chatRuns[requestID]
	if run == nil {
		return ChatRunSnapshot{}, false
	}
	return run.snapshot(), true
}

func (m *Manager) RunningChatRunSnapshot(conversationID string) (ChatRunSnapshot, bool) {
	if conversationID == "" {
		return ChatRunSnapshot{}, false
	}

	m.chatStore.chatMu.Lock()
	defer m.chatStore.chatMu.Unlock()
	m.pruneExpiredChatRunsLocked(time.Now())

	if requestID := m.chatStore.chatRunByConversation[conversationID]; requestID != "" {
		if run := m.chatStore.chatRuns[requestID]; chatRunIsRunningForConversation(run, conversationID) {
			return run.snapshot(), true
		}
	}

	var best *chatRun
	var bestRequestID string
	for requestID, run := range m.chatStore.chatRuns {
		if !chatRunIsRunningForConversation(run, conversationID) {
			continue
		}
		if best == nil ||
			run.updatedAt.After(best.updatedAt) ||
			(run.updatedAt.Equal(best.updatedAt) && requestID > bestRequestID) {
			best = run
			bestRequestID = requestID
		}
	}
	if best == nil {
		return ChatRunSnapshot{}, false
	}
	return best.snapshot(), true
}

func chatRunIsRunningForConversation(run *chatRun, conversationID string) bool {
	return run != nil &&
		!run.done &&
		run.conversationID == conversationID &&
		normalizeChatRunState(run.state) == ChatRunStateRunning
}

func (m *Manager) MarkChatRunControl(
	requestID string,
	conversationID string,
	controlType string,
	errorCode string,
	message string,
) {
	m.markChatRunControl(
		strings.TrimSpace(requestID),
		strings.TrimSpace(conversationID),
		strings.TrimSpace(controlType),
		"",
		strings.TrimSpace(errorCode),
		strings.TrimSpace(message),
		time.Now(),
	)
}

func (m *Manager) MarkChatRunPayload(
	requestID string,
	conversationID string,
	payload map[string]any,
) int64 {
	seqs := m.MarkChatRunPayloads(requestID, conversationID, []map[string]any{payload})
	if len(seqs) == 0 {
		return 0
	}
	return seqs[0]
}

func (m *Manager) MarkChatRunPayloads(
	requestID string,
	conversationID string,
	payloads []map[string]any,
) []int64 {
	requestID = strings.TrimSpace(requestID)
	conversationID = strings.TrimSpace(conversationID)
	if requestID == "" || len(payloads) == 0 {
		return nil
	}

	now := time.Now()
	persists := make([]ChatRunEventAppend, 0, len(payloads))
	broadcasts := make([]*ChatBroadcastEvent, 0, len(payloads))
	m.chatStore.chatMu.Lock()
	m.pruneExpiredChatRunsLocked(now)
	run := m.chatStore.chatRuns[requestID]
	if run == nil || run.done {
		m.chatStore.chatMu.Unlock()
		if run == nil {
			log.Printf("MarkChatRunPayloads: no run for requestID=%s", requestID)
		}
		return nil
	}
	m.updateRunConversationLocked(run, requestID, conversationID, false)
	for _, payload := range payloads {
		broadcast := m.appendChatPayloadLocked(run, payload, now)
		if broadcast == nil {
			continue
		}
		broadcasts = append(broadcasts, broadcast)
		if !isEphemeralChatBroadcastEvent(broadcast) {
			persists = append(persists, chatRunEventAppendSnapshot(run, broadcast, now))
		}
	}
	runSubscribers := run.collectSubscribers()
	m.chatStore.chatMu.Unlock()

	if len(broadcasts) == 0 {
		return nil
	}
	m.persistChatBroadcasts(persists)
	for _, s := range runSubscribers {
		for _, broadcast := range broadcasts {
			select {
			case <-s.done:
			case s.ch <- cloneChatBroadcastEvent(broadcast):
			}
		}
	}
	seqs := make([]int64, 0, len(broadcasts))
	for _, broadcast := range broadcasts {
		seqs = append(seqs, broadcast.Seq)
	}
	return seqs
}

func (m *Manager) ApplyChatRuntimeSnapshot(snapshot *gatewayv1.ChatRuntimeSnapshot) {
	if snapshot == nil {
		return
	}
	requestID := strings.TrimSpace(snapshot.GetRunId())
	conversationID := strings.TrimSpace(snapshot.GetConversationId())
	if requestID == "" || conversationID == "" {
		return
	}
	state := normalizeChatRunState(snapshot.GetState())
	if state == "" {
		state = ChatRunStateRunning
	}
	now := chatRuntimeSnapshotTime(snapshot.GetUpdatedAt())
	clientRequestID := strings.TrimSpace(snapshot.GetClientRequestId())
	workdir := strings.TrimSpace(snapshot.GetCwd())

	payload := map[string]any{
		"type":                      "runtime_snapshot",
		"conversation_id":           conversationID,
		"run_id":                    requestID,
		"state":                     state,
		"updated_at":                now.UnixMilli(),
		"revision":                  snapshot.GetRevision(),
		"entries_json":              strings.TrimSpace(snapshot.GetEntriesJson()),
		"tool_status":               strings.TrimSpace(snapshot.GetToolStatus()),
		"tool_status_is_compaction": snapshot.GetToolStatusIsCompaction(),
	}
	if clientRequestID != "" {
		payload["client_request_id"] = clientRequestID
	}
	if workerID := strings.TrimSpace(snapshot.GetWorkerId()); workerID != "" {
		payload["worker_id"] = workerID
	}

	var persist ChatRunEventAppend
	var broadcast *ChatBroadcastEvent
	var runSubscribers []*chatRunSubscriber
	var activityKind string
	var activityConversationID string
	var activityWorkdir string
	terminalState := isTerminalChatRunState(state)

	m.chatStore.chatMu.Lock()
	m.pruneExpiredChatRunsLocked(now)
	run := m.chatStore.chatRuns[requestID]
	created := false
	if run == nil {
		m.chatStore.nextChatRunEpoch += 1
		run = &chatRun{
			requestID:       requestID,
			conversationID:  conversationID,
			clientRequestID: clientRequestID,
			workdir:         workdir,
			sessionEpoch:    m.currentSessionEpoch(),
			runEpoch:        m.chatStore.nextChatRunEpoch,
			state:           state,
			nextSeq:         m.latestConversationSeqLocked(conversationID),
			updatedAt:       now,
			subscribers:     make(map[int]*chatRunSubscriber),
		}
		run.applyState(state)
		m.chatStore.chatRuns[requestID] = run
		created = true
	}
	snapshotRevision := snapshot.GetRevision()
	if snapshotRevision > 0 && run.runtimeSnapshotRevision > 0 &&
		snapshotRevision <= run.runtimeSnapshotRevision {
		m.chatStore.chatMu.Unlock()
		return
	}
	if run.done && !terminalState {
		m.chatStore.chatMu.Unlock()
		return
	}
	previousState := normalizeChatRunState(run.state)
	m.updateRunConversationLocked(run, requestID, conversationID, state == ChatRunStateRunning)
	if clientRequestID != "" {
		run.clientRequestID = clientRequestID
		m.chatStore.chatRunByClientRequest[clientRequestID] = requestID
	}
	if workdir != "" {
		run.workdir = workdir
	}
	run.applyState(state)
	run.updatedAt = now
	if terminalState {
		run.expiresAt = now.Add(chatRunDoneRetention)
	}
	if snapshotRevision > 0 {
		run.runtimeSnapshotRevision = snapshotRevision
	}
	broadcast = m.appendChatPayloadLocked(run, payload, now)
	if broadcast != nil {
		persist = chatRunEventAppendSnapshot(run, broadcast, now)
	}
	runSubscribers = run.collectSubscribers()
	if state == ChatRunStateRunning && (created || previousState != ChatRunStateRunning) {
		activityKind = "running"
	} else if terminalState {
		activityKind = "idle"
	}
	activityConversationID = run.conversationID
	activityWorkdir = run.workdir
	m.chatStore.chatMu.Unlock()

	if broadcast == nil {
		return
	}
	m.persistChatBroadcast(persist)
	notifySubscribers(runSubscribers, broadcast)
	if terminalState {
		for _, s := range runSubscribers {
			s.close()
		}
	}
	if activityKind != "" {
		m.broadcastChatRunActivity(activityKind, activityConversationID, activityWorkdir, now)
	}
}

func chatRuntimeSnapshotTime(updatedAt int64) time.Time {
	if updatedAt <= 0 {
		return time.Now()
	}
	if updatedAt < 10_000_000_000 {
		return time.Unix(updatedAt, 0)
	}
	return time.UnixMilli(updatedAt)
}

func (m *Manager) broadcastChatEvent(requestID string, event *gatewayv1.ChatEvent) {
	if event == nil {
		return
	}

	requestID = strings.TrimSpace(requestID)
	conversationID := strings.TrimSpace(event.GetConversationId())
	now := time.Now()
	m.chatStore.chatMu.Lock()
	m.pruneExpiredChatRunsLocked(now)
	broadcast := &ChatBroadcastEvent{
		RequestID: requestID,
		Event:     event,
	}
	var persist ChatRunEventAppend
	var runSubscribers []*chatRunSubscriber
	var firstDelta *ChatBroadcastEvent
	var activityKind string
	var activityConversationID string
	var activityWorkdir string
	run := m.chatStore.chatRuns[requestID]
	if run == nil && requestID != "" {
		sessionEpoch := m.currentSessionEpoch()
		m.chatStore.nextChatRunEpoch += 1
		latestSeq := m.latestConversationSeqLocked(conversationID)
		run = &chatRun{
			requestID:      requestID,
			conversationID: conversationID,
			sessionEpoch:   sessionEpoch,
			runEpoch:       m.chatStore.nextChatRunEpoch,
			state:          ChatRunStateQueued,
			nextSeq:        latestSeq,
			updatedAt:      now,
			subscribers:    make(map[int]*chatRunSubscriber),
		}
		run.applyState(ChatRunStateQueued)
		m.chatStore.chatRuns[requestID] = run
		if conversationID != "" && m.chatRunCanClaimConversationLocked(conversationID, requestID) {
			m.chatStore.chatRunByConversation[conversationID] = requestID
		}
	}
	if run == nil || run.done {
		m.chatStore.chatMu.Unlock()
		return
	}
	previousState := normalizeChatRunState(run.state)
	m.updateRunConversationLocked(run, requestID, conversationID, false)
	if normalizeChatRunState(run.state) != ChatRunStateRunning && !isTerminalChatEvent(event) {
		run.applyState(ChatRunStateRunning)
	}
	run.nextSeq += 1
	run.updatedAt = now
	broadcast.Seq = run.nextSeq
	broadcast.Workdir = run.workdir
	if isTerminalChatEvent(event) {
		if event.GetType() == gatewayv1.ChatEvent_DONE {
			run.applyState(ChatRunStateCompleted)
		} else {
			run.applyState(ChatRunStateFailed)
			if run.errorCode == "" {
				run.errorCode = "desktop_error"
			}
		}
		run.expiresAt = now.Add(chatRunDoneRetention)
	}
	nextState := normalizeChatRunState(run.state)
	activityKind, activityConversationID, activityWorkdir = detectRunActivity(run, previousState, nextState)
	run.appendEvent(broadcast)
	if !isEphemeralChatBroadcastEvent(broadcast) {
		persist = chatRunEventAppendSnapshot(run, broadcast, now)
	}
	if isFirstDeltaChatEvent(event) && !run.firstDeltaLogged {
		run.firstDeltaLogged = true
		firstDelta = cloneChatBroadcastEvent(broadcast)
	}
	runSubscribers = run.collectSubscribers()
	m.chatStore.chatMu.Unlock()

	if firstDelta != nil {
		logChatRunSpan("first_delta", firstDelta)
	}
	m.finalizeChatRunBroadcast(broadcast, persist, runSubscribers, activityKind, activityConversationID, activityWorkdir, now)
}

func (m *Manager) broadcastChatControl(requestID string, control *gatewayv1.ChatControlEvent) {
	if control == nil {
		return
	}
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		requestID = strings.TrimSpace(control.GetRequestId())
	}
	conversationID := strings.TrimSpace(control.GetConversationId())
	controlType := strings.TrimSpace(control.GetType())
	state := normalizeChatRunState(control.GetState())
	if state == "" {
		state = controlTypeToState[controlType]
	}
	errorCode := strings.TrimSpace(control.GetErrorCode())
	message := strings.TrimSpace(control.GetMessage())
	m.markChatRunControl(requestID, conversationID, controlType, state, errorCode, message, time.Now())
}

func (m *Manager) markChatRunStateSilent(
	requestID string,
	conversationID string,
	state string,
	now time.Time,
) {
	state = normalizeChatRunState(state)
	if requestID == "" || state == "" {
		return
	}
	m.chatStore.chatMu.Lock()
	defer m.chatStore.chatMu.Unlock()
	m.pruneExpiredChatRunsLocked(now)
	run := m.chatStore.chatRuns[requestID]
	if run == nil || run.done {
		return
	}
	m.updateRunConversationLocked(run, requestID, conversationID, state == ChatRunStateRunning)
	run.applyState(state)
	run.updatedAt = now
	if isTerminalChatRunState(state) {
		run.expiresAt = now.Add(chatRunDoneRetention)
	}
}

func (m *Manager) markChatRunControl(
	requestID string,
	conversationID string,
	controlType string,
	state string,
	errorCode string,
	message string,
	now time.Time,
) {
	if requestID == "" {
		return
	}

	state = normalizeChatRunState(state)
	if controlType == "" {
		controlType = stateToControlType[normalizeChatRunState(state)]
		if controlType == "" {
			controlType = "progress"
		}
	}

	var persist ChatRunEventAppend
	var activityKind string
	var activityConversationID string
	var activityWorkdir string
	m.chatStore.chatMu.Lock()
	m.pruneExpiredChatRunsLocked(now)
	run := m.chatStore.chatRuns[requestID]
	if run == nil || run.done {
		m.chatStore.chatMu.Unlock()
		if run == nil {
			log.Printf("markChatRunControl: no run for requestID=%s controlType=%s", requestID, controlType)
		}
		return
	}
	previousState := normalizeChatRunState(run.state)
	canClaim := chatRunControlCanClaimConversation(controlType, state)
	m.updateRunConversationLocked(run, requestID, conversationID, canClaim)
	broadcast := m.appendChatControlLocked(run, controlType, errorCode, message, now)
	nextState := normalizeChatRunState(run.state)
	activityKind, activityConversationID, activityWorkdir = detectRunActivity(run, previousState, nextState)
	persist = chatRunEventAppendSnapshot(run, broadcast, now)
	runSubscribers := run.collectSubscribers()
	m.chatStore.chatMu.Unlock()

	if span := chatControlSpanName(broadcast.Control); span != "" {
		logChatRunSpan(span, broadcast)
	}
	m.finalizeChatRunBroadcast(broadcast, persist, runSubscribers, activityKind, activityConversationID, activityWorkdir, now)
}

func (m *Manager) DispatchFromAgent(env *gatewayv1.AgentEnvelope) {
	m.dispatchFromAgent(nil, env)
}

func (m *Manager) DispatchFromAgentForSession(session *AgentSession, env *gatewayv1.AgentEnvelope) {
	m.dispatchFromAgent(session, env)
}

func (m *Manager) dispatchFromAgent(expected *AgentSession, env *gatewayv1.AgentEnvelope) {
	m.registry.mu.RLock()
	session := m.registry.session
	m.registry.mu.RUnlock()
	if session == nil || (expected != nil && session != expected) {
		return
	}

	if runtimeStatus := env.GetRuntimeStatus(); runtimeStatus != nil {
		m.UpdateRuntimeStatus(session, runtimeStatus)
		return
	}

	if runtimeSnapshot := env.GetChatRuntimeSnapshot(); runtimeSnapshot != nil {
		m.ApplyChatRuntimeSnapshot(runtimeSnapshot)
		return
	}

	if chatEvent := env.GetChatEvent(); chatEvent != nil {
		m.broadcastChatEvent(env.GetRequestId(), chatEvent)
	}

	if chatControl := env.GetChatControl(); chatControl != nil {
		m.broadcastChatControl(env.GetRequestId(), chatControl)
	}

	if historySync := env.GetHistorySync(); historySync != nil {
		m.broadcastHistorySync(historySync)
		return
	}

	if settingsSync := env.GetSettingsSync(); settingsSync != nil {
		m.broadcastSettingsSync(settingsSync)
		return
	}

	if terminalEvent := env.GetTerminalEvent(); terminalEvent != nil {
		m.broadcastTerminalEvent(terminalEvent)
		return
	}

	if sftpEvent := env.GetSftpEvent(); sftpEvent != nil {
		m.broadcastSftpEvent(sftpEvent)
		return
	}

	if chatQueueEvent := env.GetChatQueueEvent(); chatQueueEvent != nil {
		m.broadcastChatQueueEvent(chatQueueEvent)
		return
	}

	if tunnelFrame := env.GetTunnelFrame(); tunnelFrame != nil {
		m.dispatchTunnelFrame(tunnelFrame)
		return
	}

	if tunnelControl := env.GetTunnelControl(); tunnelControl != nil {
		m.handleAgentTunnelControl(session, env.GetRequestId(), tunnelControl)
		return
	}

	session.dispatch(env)
}

func (r *chatRun) snapshot() ChatRunSnapshot {
	var firstSeq int64
	if len(r.events) > 0 {
		firstSeq = r.events[0].Seq
	}
	return ChatRunSnapshot{
		RequestID:       r.requestID,
		ConversationID:  r.conversationID,
		ClientRequestID: r.clientRequestID,
		Workdir:         r.workdir,
		FirstSeq:        firstSeq,
		LatestSeq:       r.nextSeq,
		RunEpoch:        r.runEpoch,
		State:           r.state,
		ErrorCode:       r.errorCode,
		Done:            r.done,
	}
}

func (r *chatRun) applyState(state string) {
	state = normalizeChatRunState(state)
	if state == "" {
		state = ChatRunStateQueued
	}
	r.state = state
	r.accepted = state != ChatRunStateQueued
	r.started = state == ChatRunStateRunning || state == ChatRunStateCompleted
	r.done = isTerminalChatRunState(state)
	if state != ChatRunStateFailed {
		r.errorCode = ""
	}
}

func (r *chatRun) appendEvent(event *ChatBroadcastEvent) {
	if r == nil || event == nil {
		return
	}
	if revision := runtimeSnapshotRevisionFromPayload(event.Payload); revision > r.runtimeSnapshotRevision {
		r.runtimeSnapshotRevision = revision
	}
	r.events = appendCappedChatRunEvent(r.events, event, maxBufferedChatRunEvents)
}

func appendCappedChatRunEvent(
	events []*ChatBroadcastEvent,
	event *ChatBroadcastEvent,
	limit int,
) []*ChatBroadcastEvent {
	if event == nil {
		return events
	}
	if limit <= 0 {
		return events[:0]
	}
	cloned := cloneChatBroadcastEvent(event)
	if len(events) < limit {
		return append(events, cloned)
	}
	if len(events) > limit {
		events = events[len(events)-limit:]
	}
	copy(events, events[1:])
	events[len(events)-1] = cloned
	return events
}

func (r *chatRun) shouldPrune(now time.Time) bool {
	if r == nil {
		return true
	}
	if r.done {
		return !r.expiresAt.IsZero() && now.After(r.expiresAt)
	}
	return !r.updatedAt.IsZero() && now.Sub(r.updatedAt) > chatRunStaleRetention
}

func (s *chatRunSubscriber) close() {
	s.closeOnce.Do(func() {
		close(s.done)
	})
}

func (m *Manager) updateRunConversationLocked(run *chatRun, requestID string, conversationID string, canClaim bool) {
	if conversationID == "" {
		return
	}
	if run.conversationID != "" && run.conversationID != conversationID {
		if m.chatStore.chatRunByConversation[run.conversationID] == requestID {
			delete(m.chatStore.chatRunByConversation, run.conversationID)
		}
	}
	run.conversationID = conversationID
	if canClaim || m.chatRunCanClaimConversationLocked(conversationID, requestID) {
		m.chatStore.chatRunByConversation[conversationID] = requestID
	}
}

func (r *chatRun) collectSubscribers() []*chatRunSubscriber {
	subs := make([]*chatRunSubscriber, 0, len(r.subscribers))
	for _, s := range r.subscribers {
		subs = append(subs, s)
	}
	return subs
}

func notifySubscribers(subscribers []*chatRunSubscriber, broadcast *ChatBroadcastEvent) {
	for _, s := range subscribers {
		select {
		case <-s.done:
		case s.ch <- cloneChatBroadcastEvent(broadcast):
		}
	}
}

func (m *Manager) pruneExpiredChatRunsLocked(now time.Time) {
	for requestID, run := range m.chatStore.chatRuns {
		if run == nil {
			delete(m.chatStore.chatRuns, requestID)
			continue
		}
		if run.shouldPrune(now) {
			m.removeChatRunLocked(requestID, run)
		}
	}
}

func (m *Manager) removeChatRunLocked(requestID string, run *chatRun) {
	if run.conversationID != "" && m.chatStore.chatRunByConversation[run.conversationID] == requestID {
		delete(m.chatStore.chatRunByConversation, run.conversationID)
	}
	if run.clientRequestID != "" && m.chatStore.chatRunByClientRequest[run.clientRequestID] == requestID {
		delete(m.chatStore.chatRunByClientRequest, run.clientRequestID)
	}
	delete(m.chatStore.chatRuns, requestID)
	for _, subscriber := range run.subscribers {
		subscriber.close()
	}
}

func (m *Manager) releaseCompletedChatRunLocked(requestID string, run *chatRun) {
	if run.conversationID != "" && m.chatStore.chatRunByConversation[run.conversationID] == requestID {
		delete(m.chatStore.chatRunByConversation, run.conversationID)
	}
	if run.clientRequestID != "" && m.chatStore.chatRunByClientRequest[run.clientRequestID] == requestID {
		delete(m.chatStore.chatRunByClientRequest, run.clientRequestID)
	}
	delete(m.chatStore.chatRuns, requestID)
}

func cloneChatBroadcastEvent(event *ChatBroadcastEvent) *ChatBroadcastEvent {
	if event == nil {
		return nil
	}
	return &ChatBroadcastEvent{
		RequestID: event.RequestID,
		Event:     event.Event,
		Control:   event.Control,
		Payload:   cloneChatPayloadMap(event.Payload),
		Seq:       event.Seq,
		Workdir:   event.Workdir,
	}
}

func cloneChatPayloadMap(input map[string]any) map[string]any {
	if len(input) == 0 {
		return nil
	}
	out := make(map[string]any, len(input))
	for k, v := range input {
		out[k] = v
	}
	return out
}

var validChatRunStates = map[string]bool{
	ChatRunStateQueued:        true,
	ChatRunStateDelivered:     true,
	ChatRunStateClaimed:       true,
	ChatRunStateStarting:      true,
	ChatRunStateDesktopQueued: true,
	ChatRunStateRunning:       true,
	ChatRunStateCompleted:     true,
	ChatRunStateFailed:        true,
	ChatRunStateCancelled:     true,
}

func normalizeChatRunState(state string) string {
	if validChatRunStates[state] {
		return state
	}
	return ""
}

var terminalChatRunStates = map[string]bool{
	ChatRunStateCompleted: true,
	ChatRunStateFailed:    true,
	ChatRunStateCancelled: true,
}

func isTerminalChatRunState(state string) bool {
	return terminalChatRunStates[normalizeChatRunState(state)]
}

var activeChatRunStates = map[string]bool{
	ChatRunStateQueued:    true,
	ChatRunStateDelivered: true,
	ChatRunStateClaimed:   true,
	ChatRunStateStarting:  true,
	ChatRunStateRunning:   true,
}

var controlTypeToState = map[string]string{
	"accepted":     ChatRunStateQueued,
	"delivered":    ChatRunStateDelivered,
	"claimed":      ChatRunStateClaimed,
	"starting":     ChatRunStateStarting,
	"queued_in_gui": ChatRunStateDesktopQueued,
	"started":      ChatRunStateRunning,
	"completed":    ChatRunStateCompleted,
	"failed":       ChatRunStateFailed,
	"cancelled":    ChatRunStateCancelled,
}

var stateToControlType = map[string]string{
	ChatRunStateQueued:        "accepted",
	ChatRunStateDelivered:     "delivered",
	ChatRunStateClaimed:       "claimed",
	ChatRunStateStarting:      "starting",
	ChatRunStateDesktopQueued: "queued_in_gui",
	ChatRunStateRunning:       "started",
	ChatRunStateCompleted:     "completed",
	ChatRunStateFailed:        "failed",
	ChatRunStateCancelled:     "cancelled",
}

func detectRunActivity(run *chatRun, previousState, nextState string) (kind, conversationID, workdir string) {
	if isTerminalChatRunState(nextState) {
		kind = "idle"
	} else if previousState != ChatRunStateRunning && nextState == ChatRunStateRunning {
		kind = "running"
	}
	if kind != "" {
		conversationID = run.conversationID
		workdir = run.workdir
	}
	return
}

func (m *Manager) finalizeChatRunBroadcast(broadcast *ChatBroadcastEvent, persist ChatRunEventAppend, subscribers []*chatRunSubscriber, activityKind, activityConversationID, activityWorkdir string, now time.Time) {
	if broadcast == nil {
		return
	}
	m.persistChatBroadcast(persist)
	notifySubscribers(subscribers, broadcast)
	if activityKind != "" {
		m.broadcastChatRunActivity(activityKind, activityConversationID, activityWorkdir, now)
	}
}

func (m *Manager) appendChatControlLocked(
	run *chatRun,
	controlType string,
	errorCode string,
	message string,
	now time.Time,
) *ChatBroadcastEvent {
	if run == nil {
		return nil
	}
	state := controlTypeToState[controlType]
	if state == "" {
		state = normalizeChatRunState(run.state)
	}
	if state == "" {
		state = ChatRunStateQueued
	}
	run.applyState(state)
	if errorCode != "" {
		run.errorCode = errorCode
	}
	run.updatedAt = now
	if isTerminalChatRunState(state) {
		run.expiresAt = now.Add(chatRunDoneRetention)
	}
	run.nextSeq += 1
	seq := run.nextSeq
	if controlType == "" {
		controlType = stateToControlType[normalizeChatRunState(state)]
		if controlType == "" {
			controlType = "progress"
		}
	}
	control := &gatewayv1.ChatControlEvent{
		RequestId:       run.requestID,
		ClientRequestId: run.clientRequestID,
		ConversationId:  run.conversationID,
		RunEpoch:        run.runEpoch,
		Type:            controlType,
		State:           run.state,
		ErrorCode:       run.errorCode,
		Message:         message,
		Seq:             seq,
	}
	broadcast := &ChatBroadcastEvent{
		RequestID: run.requestID,
		Control:   control,
		Seq:       seq,
		Workdir:   run.workdir,
	}
	run.appendEvent(broadcast)
	return broadcast
}

func (m *Manager) appendChatPayloadLocked(
	run *chatRun,
	payload map[string]any,
	now time.Time,
) *ChatBroadcastEvent {
	if run == nil || len(payload) == 0 {
		return nil
	}
	run.updatedAt = now
	run.nextSeq += 1
	seq := run.nextSeq
	nextPayload := cloneChatPayloadMap(payload)
	if nextPayload == nil {
		nextPayload = make(map[string]any)
	}
	nextPayload["request_id"] = run.requestID
	nextPayload["client_request_id"] = run.clientRequestID
	nextPayload["conversation_id"] = run.conversationID
	nextPayload["run_epoch"] = run.runEpoch
	nextPayload["state"] = run.state
	nextPayload["seq"] = seq
	broadcast := &ChatBroadcastEvent{
		RequestID: run.requestID,
		Payload:   nextPayload,
		Seq:       seq,
		Workdir:   run.workdir,
	}
	run.appendEvent(broadcast)
	return broadcast
}

func chatRunEventAppendSnapshot(
	run *chatRun,
	broadcast *ChatBroadcastEvent,
	now time.Time,
) ChatRunEventAppend {
	if run == nil || broadcast == nil {
		return ChatRunEventAppend{}
	}
	return ChatRunEventAppend{
		RequestID:       run.requestID,
		ConversationID:  run.conversationID,
		ClientRequestID: run.clientRequestID,
		Workdir:         run.workdir,
		RunEpoch:        run.runEpoch,
		State:           run.state,
		ErrorCode:       run.errorCode,
		Done:            run.done,
		Event:           cloneChatBroadcastEvent(broadcast),
		CreatedAt:       now,
	}
}

func (m *Manager) persistChatBroadcast(input ChatRunEventAppend) {
	m.persistChatBroadcasts([]ChatRunEventAppend{input})
}

func (m *Manager) persistChatBroadcasts(inputs []ChatRunEventAppend) {
	if m.chatStore.eventStore == nil {
		return
	}
	validInputs := make([]ChatRunEventAppend, 0, len(inputs))
	for _, input := range inputs {
		if input.Event != nil {
			validInputs = append(validInputs, input)
		}
	}
	if len(validInputs) == 0 || m.chatStore.eventStore == nil {
		return
	}
	if err := m.chatStore.eventStore.AppendEvents(validInputs); err != nil {
		first := validInputs[0]
		log.Printf("persist chat events failed: run_id=%s count=%d first_seq=%d err=%v", first.RequestID, len(validInputs), first.Event.Seq, err)
	}
}

func isTerminalChatEvent(event *gatewayv1.ChatEvent) bool {
	if event == nil {
		return false
	}
	return event.GetType() == gatewayv1.ChatEvent_DONE || event.GetType() == gatewayv1.ChatEvent_ERROR
}

func isFirstDeltaChatEvent(event *gatewayv1.ChatEvent) bool {
	if event == nil {
		return false
	}
	switch event.GetType() {
	case gatewayv1.ChatEvent_TOKEN,
		gatewayv1.ChatEvent_THINKING,
		gatewayv1.ChatEvent_TOOL_CALL,
		gatewayv1.ChatEvent_TOOL_STATUS,
		gatewayv1.ChatEvent_HOSTED_SEARCH:
		return true
	default:
		return false
	}
}

func isEphemeralChatPayload(payload map[string]any) bool {
	if payload == nil {
		return false
	}
	eventType, _ := payload["type"].(string)
	return eventType == "tool_call_delta"
}

func isEphemeralChatEvent(event *gatewayv1.ChatEvent) bool {
	if event == nil || event.GetType() != gatewayv1.ChatEvent_TOOL_CALL {
		return false
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(strings.TrimSpace(event.GetData())), &payload); err != nil {
		return false
	}
	return isEphemeralChatPayload(payload)
}

func isEphemeralChatBroadcastEvent(event *ChatBroadcastEvent) bool {
	if event == nil {
		return false
	}
	if len(event.Payload) > 0 {
		return isEphemeralChatPayload(event.Payload)
	}
	return isEphemeralChatEvent(event.Event)
}

func runtimeSnapshotRevisionFromPayload(payload map[string]any) int64 {
	if len(payload) == 0 {
		return 0
	}
	eventType, _ := payload["type"].(string)
	if eventType != "runtime_snapshot" {
		return 0
	}
	return toPositiveInt64(payload["revision"])
}

func toPositiveInt64(v any) int64 {
	switch n := v.(type) {
	case int64:
		if n > 0 {
			return n
		}
	case float64:
		if n > 0 {
			return int64(n)
		}
	case json.Number:
		if parsed, err := n.Int64(); err == nil && parsed > 0 {
			return parsed
		}
	case int:
		if n > 0 {
			return int64(n)
		}
	}
	return 0
}

func chatControlSpanName(control *gatewayv1.ChatControlEvent) string {
	if control == nil {
		return ""
	}
	switch control.GetType() {
	case "claimed":
		return "runtime_claimed"
	case "started":
		return "runtime_started"
	case "completed":
		return "run_completed"
	case "failed":
		return "run_failed"
	case "cancelled":
		return "run_cancelled"
	default:
		return ""
	}
}

func logChatRunSpan(span string, event *ChatBroadcastEvent) {
	if event == nil {
		return
	}
	runID := event.RequestID
	conversationID := ""
	clientRequestID := ""
	if event.Control != nil {
		conversationID = event.Control.GetConversationId()
		clientRequestID = event.Control.GetClientRequestId()
	} else if event.Payload != nil {
		if value, ok := event.Payload["conversation_id"].(string); ok {
			conversationID = value
		}
		if value, ok := event.Payload["client_request_id"].(string); ok {
			clientRequestID = value
		}
	} else if event.Event != nil {
		conversationID = event.Event.GetConversationId()
	}
	log.Printf(
		"chat_run_span span=%s run_id=%q conversation_id=%q client_request_id=%q seq=%d",
		span,
		runID,
		conversationID,
		clientRequestID,
		event.Seq,
	)
}
