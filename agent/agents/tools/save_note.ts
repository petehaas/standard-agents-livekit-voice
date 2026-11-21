import { defineTool } from '@standardagents/spec';
import { z } from 'zod';

const NOTES_PATH = '/call-notes.md';

export default defineTool({
  description:
    'Save a short note from the call, such as a reminder, a to-do, or something the caller asked you to remember. Notes are kept in the thread file /call-notes.md.',
  args: z.object({
    note: z.string().min(1).max(500).describe('The note, in one or two sentences'),
  }),
  execute: async (state, { note }) => {
    const existing = await state.readFile(NOTES_PATH);
    const previous = existing ? new TextDecoder().decode(existing) : '# Call notes\n\n';
    const line = `- ${new Date().toISOString()}: ${note.replace(/\s+/g, ' ').trim()}\n`;
    await state.writeFile(NOTES_PATH, previous + line, 'text/markdown');
    return { status: 'success', result: `Saved the note to ${NOTES_PATH}.` };
  },
});
