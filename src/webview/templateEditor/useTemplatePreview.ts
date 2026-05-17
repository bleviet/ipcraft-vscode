import { useState, useEffect } from 'react';
import * as nunjucks from 'nunjucks';

export function useTemplatePreview(
  source: string,
  context: Record<string, unknown>
): { preview: string; error: string | null } {
  const [preview, setPreview] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const result = nunjucks.renderString(source, context);
        setPreview(result);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPreview('');
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [source, context]);

  return { preview, error };
}
