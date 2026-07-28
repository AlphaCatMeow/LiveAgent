import { useCallback, useEffect, useRef, useState } from "react";
import { type AppSettings, updateSkills } from "../../lib/settings";
import {
  discoverSkills,
  isAlwaysEnabledSkillName,
  type SkillSummary,
  subscribeSkillsDiscoveryUpdated,
} from "../../lib/skills";

type UseChatSkillsParams = {
  skillsEnabled: boolean;
  selectedSkillNames: string[];
  setSettings: (updater: (prev: AppSettings) => AppSettings) => void;
};

function reconcileSelectedSkills(params: {
  skills: SkillSummary[];
  setSettings: (updater: (prev: AppSettings) => AppSettings) => void;
}) {
  const { skills, setSettings } = params;
  const names = new Set(skills.map((skill) => skill.name));
  setSettings((prev) => {
    const presets = prev.skills.presets.map((preset) => ({
      ...preset,
      skillNames: preset.skillNames.filter(
        (name) => isAlwaysEnabledSkillName(name) || names.has(name),
      ),
    }));
    const unchanged = presets.every(
      (preset, index) =>
        preset.skillNames.join("\n") === prev.skills.presets[index]?.skillNames.join("\n"),
    );
    return unchanged ? prev : updateSkills(prev, { presets });
  });
}

export function useChatSkills(params: UseChatSkillsParams) {
  const { skillsEnabled, setSettings } = params;
  const [availableSkills, setAvailableSkills] = useState<SkillSummary[]>([]);
  const [skillsRootDir, setSkillsRootDir] = useState("");
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsLoadError, setSkillsLoadError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const requestSequenceRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applyDisabledState = useCallback(() => {
    if (!mountedRef.current) return;
    setAvailableSkills([]);
    setSkillsRootDir("");
    setSkillsLoadError(null);
    setSkillsLoading(false);
  }, []);

  const runDiscovery = useCallback(
    async (options?: { force?: boolean }) => {
      if (!skillsEnabled) {
        requestSequenceRef.current += 1;
        applyDisabledState();
        return null;
      }

      const requestId = requestSequenceRef.current + 1;
      requestSequenceRef.current = requestId;
      if (mountedRef.current) {
        setSkillsLoading(true);
        setSkillsLoadError(null);
      }

      try {
        const discovery = await discoverSkills({ force: options?.force });
        if (!mountedRef.current || requestSequenceRef.current !== requestId) {
          return null;
        }
        setSkillsRootDir(discovery.rootDir);
        setAvailableSkills(discovery.skills);
        reconcileSelectedSkills({
          skills: discovery.skills,
          setSettings,
        });
        return discovery;
      } catch (err) {
        if (!mountedRef.current || requestSequenceRef.current !== requestId) {
          return null;
        }
        const msg = err instanceof Error ? err.message : String(err);
        setSkillsRootDir("");
        setAvailableSkills([]);
        setSkillsLoadError(msg || "加载 skills 失败");
        return null;
      } finally {
        if (mountedRef.current && requestSequenceRef.current === requestId) {
          setSkillsLoading(false);
        }
      }
    },
    [applyDisabledState, setSettings, skillsEnabled],
  );

  const refreshSkills = useCallback(async () => {
    return runDiscovery({ force: true });
  }, [runDiscovery]);

  useEffect(() => {
    void runDiscovery();
  }, [runDiscovery]);

  useEffect(() => {
    if (!skillsEnabled) return;
    return subscribeSkillsDiscoveryUpdated(() => {
      void runDiscovery({ force: true });
    });
  }, [runDiscovery, skillsEnabled]);

  return {
    availableSkills,
    skillsRootDir,
    skillsLoading,
    skillsLoadError,
    refreshSkills,
  };
}
