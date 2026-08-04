import { useEffect, useRef, useState } from 'react';
import { checkWordLocally } from '../local-spell-checker';
import {
  buildWhatsAppChatWordCandidates,
  collectWhatsAppSpellcheckWords,
  rankWhatsAppSpellSuggestions,
  type WhatsAppComposerSpellIssue,
} from './composerSpellcheck';

interface WaComposerSpellcheckState {
  issues: WhatsAppComposerSpellIssue[];
  checking: boolean;
}

export function useWaComposerSpellcheck(text: string, enabled = true): WaComposerSpellcheckState {
  const [issues, setIssues] = useState<WhatsAppComposerSpellIssue[]>([]);
  const [checking, setChecking] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    const request = ++requestRef.current;
    const words = enabled ? collectWhatsAppSpellcheckWords(text) : [];
    if (words.length === 0) {
      setIssues([]);
      setChecking(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setChecking(true);
      Promise.all(words.map(async (word) => {
        const result = await checkWordLocally(word, { ignoreUppercase: true });
        if (!result.available || result.correct) return { word, result, validChatCandidates: [] as string[] };

        const candidates = buildWhatsAppChatWordCandidates(word);
        const candidateChecks = await Promise.all(candidates.map(async candidate => ({
          candidate,
          check: await checkWordLocally(candidate, { ignoreUppercase: true }),
        })));
        const validChatCandidates = candidateChecks
          .filter(({ check }) => check.available && check.correct)
          .map(({ candidate }) => candidate);
        return { word, result, validChatCandidates };
      }))
        .then((checked) => {
          if (request !== requestRef.current) return;
          setIssues(checked
            .filter(({ result }) => result.available && !result.correct)
            .map(({ word, result, validChatCandidates }) => ({
              word,
              suggestions: rankWhatsAppSpellSuggestions(word, result.suggestions, validChatCandidates),
            }))
            .slice(0, 6));
        })
        .catch(() => {
          if (request === requestRef.current) setIssues([]);
        })
        .finally(() => {
          if (request === requestRef.current) setChecking(false);
        });
    }, 420);

    return () => window.clearTimeout(timer);
  }, [enabled, text]);

  return { issues, checking };
}
