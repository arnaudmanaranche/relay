import { useEffect, useMemo, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';

// A skill's `---\nid: …\n---` block is metadata, not prose: handed to the
// markdown renderer it comes out as a setext heading, so the preview opened
// with "id: x description: y" as its title. The textarea still holds the whole
// file, because the frontmatter is editable too.
function withoutFrontmatter(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
  return match ? match[1] : content;
}

interface Props {
  title: string;
  /** Shown under the title: a project-relative path, or a template's origin. */
  subtitle: string;
  load: () => Promise<string>;
  /** Omit for a read-only view (templates). */
  onSave?: (content: string) => Promise<void>;
  /** Rendered instead of the Save button when the file cannot be edited here. */
  readOnlyAction?: ReactNode;
  children?: ReactNode;
}

// Generic markdown editor: a role's prompt, a project skill, or a read-only
// starter template. Loading goes through the caller's `load()` so every
// caller gets the shared error handling in api.ts — an inline fetch here used
// to swallow a 404 and hand back an empty editor, which Save then wrote over
// the file.
export function FileEditor({ title, subtitle, load, onSave, readOnlyAction, children }: Props) {
  const [content, setContent] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useMemo(() => withoutFrontmatter(content), [content]);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setError(null);
    load()
      .then(text => {
        if (cancelled) return;
        setContent(text);
        setDirty(false);
        setLoaded(true);
      })
      .catch(err => {
        if (cancelled) return;
        setContent('');
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [subtitle]);

  async function handleSave() {
    if (!onSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(content);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="file-editor">
      <div className="prompt-editor-header">
        <h2>{title}</h2>
        {onSave ? (
          <button className="btn primary" onClick={handleSave} disabled={!dirty || saving || !loaded}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        ) : (
          readOnlyAction
        )}
      </div>
      <p className="prompt-editor-path">{subtitle}</p>

      {error && <p className="editor-error">{error}</p>}

      <div className="prompt-editor-panes">
        <textarea
          value={content}
          readOnly={!onSave}
          disabled={!loaded}
          onChange={e => {
            setContent(e.target.value);
            setDirty(true);
          }}
        />
        <div className="prompt-editor-preview">
          <ReactMarkdown>{preview}</ReactMarkdown>
        </div>
      </div>

      {children}
    </div>
  );
}
