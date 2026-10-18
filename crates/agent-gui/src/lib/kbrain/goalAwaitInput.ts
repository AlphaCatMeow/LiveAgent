/**
 * 目标续跑中，模型的回复若在等用户直接回答（提问、请求确认、请求选择），后端仍会
 * 自动发起下一轮，模型拿不到答案只能反复追问，白白消耗 token。这里识别这种回复，
 * 由调用方暂停目标；用户下一条普通消息再带着回复恢复目标，由模型按新指令决定
 * 继续执行还是交还控制（再次提问会被再次暂停）。
 */
const awaitingConversations = new Set<string>();

export function markGoalAwaitingInput(conversationId: string) {
  const key = conversationId.trim();
  if (key) awaitingConversations.add(key);
}

/** 读取并清除标记：只有暂停后的第一条普通消息负责恢复目标。 */
export function takeGoalAwaitingInput(conversationId: string): boolean {
  return awaitingConversations.delete(conversationId.trim());
}

export function clearGoalAwaitingInput(conversationId: string) {
  awaitingConversations.delete(conversationId.trim());
}

/**
 * 回复是否宣告目标已完成。K-brain goalloop.Met 要求最终回复以 GOAL_MET 开头；
 * 前端拿到的文字块有时把工具调用前的话和最终回复拼在一起（“…再读取核对。
 * GOAL_MET — 已创建”），所以 GOAL_MET 出现在开头、换行后或句末标点后都算，
 * 后面不能紧跟单词字符。“不是 GOAL_MET”这类句中提及不算。用户回复那一轮是
 * 普通运行，后端不判定目标，由前端据此决定是否还要续跑。
 */
export function assistantDeclaresGoalMet(text: string): boolean {
  return /(?:^|[\n。！？.!?])[\s*_#>`~]*GOAL_MET(?![A-Za-z0-9_-])/u.test(text);
}

/** 判断一轮回复的最终文本是否在等待用户直接回答。 */
export function assistantAwaitsUserInput(text: string): boolean {
  // 代码块里的问号和措辞不是对用户说的。
  const prose = text.replace(/```[\s\S]*?```/g, "").trim();
  if (!prose) return false;
  // 只看最后一段：前面段落里的设问不算在等用户。模型常把问题放在段首、说明放在
  // 段尾（“标题用什么？”换行“我还没有写入文件。”），所以段内任一行以问号结尾都算。
  const lastParagraph = prose.split(/\n\s*\n/).at(-1) ?? prose;
  const asksQuestion = lastParagraph
    .split("\n")
    .some((line) => /[?？]$/u.test(line.replace(/[\s*_`)）」』"'”’]+$/u, "")));
  return asksQuestion || awaitingInputPhrases.some((phrase) => phrase.test(lastParagraph));
}

/** 请求用户确认、选择或补充信息的措辞；宁可多停一次，也不让续跑空转。 */
const awaitingInputPhrases = [
  /请(你|您)?(确认|选择|告诉我|回复|回答|提供|决定|明确|指定|补充|给出)/u,
  /(等待|等)(你|您)/u,
  /(没有|未|没)收到(你|您)/u,
  /收到(后|之后|以后|你|您)/u,
  /(你|您)(希望|想要|倾向|打算|决定)/u,
  /是否(需要|要|继续|同意)/u,
  /\b(please (confirm|choose|select|let me know|advise|clarify|reply|provide))\b/i,
  /\b(let me know|should i|would you like|do you want|which (one|option))\b/i,
  /\b(waiting for (your|you)|once you (reply|confirm|provide))\b/i,
];
