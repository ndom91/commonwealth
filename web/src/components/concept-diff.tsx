import { MultiFileDiff } from '@pierre/diffs/react';
import { useEffect, useMemo, useState } from 'react';

function themeType(): 'dark' | 'light' | 'system' {
  const theme = document.documentElement.dataset.theme;
  return theme === 'dark' || theme === 'light' ? theme : 'system';
}

export function ConceptDiff({
  newer,
  older,
  path,
}: {
  newer: string;
  older: string;
  path: string;
}) {
  const [theme, setTheme] = useState(themeType);

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(themeType()));
    observer.observe(document.documentElement, { attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const options = useMemo(
    () => ({
      diffIndicators: 'classic' as const,
      diffStyle: 'unified' as const,
      hunkSeparators: 'line-info-basic' as const,
      lineDiffType: 'word-alt' as const,
      theme: { dark: 'pierre-dark', light: 'pierre-light' },
      themeType: theme,
    }),
    [theme]
  );

  return (
    <div className="concept-diff">
      <MultiFileDiff
        oldFile={{ contents: older, lang: 'markdown', name: path }}
        newFile={{ contents: newer, lang: 'markdown', name: path }}
        options={options}
      />
    </div>
  );
}
