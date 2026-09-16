import { useEffect, useMemo, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import type { LoadedFile } from '../api';
import { withoutFrontmatter } from '../markdown';

interface Props {
  title: string;
  /** Shown under the title: a project-relative path, or a template's origin. */
  subtitle: string;
  load: () => Promise<LoadedFile>;
  /** Omit for a read-only view (templates). */
  onSave?: (content: string, version: number) => Promise<number>;
  /** Rendered instead of the Save button when the file cannot be edited here. */
  readOnlyAction?: ReactNode;
  children?: ReactNode;
}

// Generic markdown editor: a role's prompt, a project skill, or a read-only
// starter template. Loading goes through the caller's `load()` so every caller
// gets the shared error handling in api.ts — an inline fetch here used to
// swallow a 404 and hand back an empty editor, which Save then wrote over the
// file.
export function FileEditor({ title, subtitle, load, onSave, readOnlyAction, children }: Props) {
  const [content, setContent] = useState('');
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A 409 means the file moved under us. Offering "reload" is the only safe
  // way out, and it has to be explicit: silently reloading would throw away
  // whatever the user had typed.
  const [conflict, setConflict] = useState<string | null>(null);
  const preview = useMemo(() => withoutFrontmatter(content), [content]);

  // Shared by the initial load and the reload a conflict offers. `alive`
  // guards the mount path, where switching file mid-flight would otherwise
  // land the old file's content in the new file's editor.
  function read(alive: () => boolean = () => true) {
    setLoaded(false);
    setError(null);
    setConflict(null);
    return load()
      .then(file => {
        if (!alive()) return;
        setContent(file.content);
        setVersion(file.version);
        setDirty(false);
        setLoaded(true);
      })
      .catch(err => {
        if (!alive()) return;
        setContent('');
        setError(err instanceof Error ? err.message : String(err));
      });
  }

  useEffect(() => {
    let cancelled = false;
    read(() => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [subtitle]);

  async function handleSave() {
    if (!onSave) return;
    setSaving(true);
    setError(null);
    setConflict(null);
    try {
      setVersion(await onSave(content, version));
      setDirty(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('changed on disk')) setConflict(message);
      else setError(message);
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
      {conflict && (
        <div className="editor-conflict">
          <p>{conflict}</p>
          <button className="btn" onClick={() => read()}>
            Reload and lose my edits
          </button>
        </div>
      )}

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
