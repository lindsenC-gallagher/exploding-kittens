import { Fragment, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
// The repo-root CHANGELOG.md is the single source of truth; we render it in-app
// so the doc and the in-game "What's new" panel can never drift apart.
import changelogRaw from '../../../../CHANGELOG.md?raw';

/** A parsed changelog block: a date/section heading, a sub-heading, or a list. */
type Block =
  | { type: 'h2'; text: string }
  | { type: 'h3'; text: string }
  | { type: 'ul'; items: string[] };

/**
 * Parse the subset of Markdown our CHANGELOG.md uses: `##` date sections, `###`
 * Added/Changed/Fixed sub-headings, and `-` bullet lists. The `#` title and the
 * intro paragraphs (doc-oriented) are skipped — the in-game panel only shows the
 * entries. Empty sections (e.g. an `## [Unreleased]` with nothing under it) drop out.
 */
function parseChangelog(raw: string): Block[] {
  const blocks: Block[] = [];
  let started = false;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('## ')) {
      started = true;
      blocks.push({ type: 'h2', text: trimmed.slice(3).trim() });
    } else if (!started) {
      continue;
    } else if (trimmed.startsWith('### ')) {
      blocks.push({ type: 'h3', text: trimmed.slice(4).trim() });
    } else if (trimmed.startsWith('- ')) {
      const item = trimmed.slice(2).trim();
      const last = blocks[blocks.length - 1];
      if (last && last.type === 'ul') last.items.push(item);
      else blocks.push({ type: 'ul', items: [item] });
    } else if (trimmed && /^\s/.test(line)) {
      // A wrapped continuation of the current bullet (indented, no marker).
      const last = blocks[blocks.length - 1];
      if (last && last.type === 'ul' && last.items.length) {
        last.items[last.items.length - 1] += ' ' + trimmed;
      }
    }
  }
  // Drop section headings that have no content before the next section heading.
  return blocks.filter((b, i) => {
    if (b.type !== 'h2') return true;
    const next = blocks[i + 1];
    return !!next && next.type !== 'h2';
  });
}

/** Render inline `**bold**` and `` `code` `` within a list item. */
function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(<Fragment key={key++}>{text.slice(last, m.index)}</Fragment>);
    if (m[1] !== undefined) parts.push(<b key={key++}>{m[1]}</b>);
    else parts.push(<code key={key++}>{m[2]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  return parts;
}

const BLOCKS = parseChangelog(changelogRaw);

/** Heading "label" → an emoji, so Added/Changed/Fixed read at a glance. */
const KIND_ICON: Record<string, string> = { added: '✨', changed: '🔧', fixed: '🐛', removed: '🗑️' };

/**
 * Floating "What's new" button + a scrollable changelog modal. Rendered on the
 * home screen (before joining) and in the room (after joining). `right` offsets
 * the button so it can sit beside the Help / Mute FABs.
 */
export function ChangelogButton({ right = 12 }: { right?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="changelog-fab"
        style={{ right }}
        aria-label="What's new"
        title="What's new"
        onClick={() => setOpen(true)}
      >
        ✨
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          >
            <motion.div
              className="modal changelog-modal"
              initial={{ scale: 0.92, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2 className="title" style={{ fontSize: 26, margin: 0 }}>
                  What&apos;s new ✨
                </h2>
                <button className="ghost" onClick={() => setOpen(false)} aria-label="Close">
                  ✕
                </button>
              </div>

              <div className="changelog-body">
                {BLOCKS.map((b, i) => {
                  if (b.type === 'h2') return <h3 key={i} className="changelog-date">{b.text}</h3>;
                  if (b.type === 'h3') {
                    const icon = KIND_ICON[b.text.toLowerCase()];
                    return (
                      <h4 key={i} className="changelog-kind">
                        {icon ? `${icon} ` : ''}
                        {b.text}
                      </h4>
                    );
                  }
                  return (
                    <ul key={i} className="changelog-list">
                      {b.items.map((it, j) => (
                        <li key={j}>{inline(it)}</li>
                      ))}
                    </ul>
                  );
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
