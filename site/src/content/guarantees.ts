/** Eight things Relay holds to whatever the model says it wants to do. Each
 *  one is a check in the pipeline rather than a line in a prompt: a prompt
 *  that says "don't touch files outside the feature" is a suggestion. Written
 *  from the reader's side: what can't happen to your repo, not which file
 *  enforces it. */
export interface Guarantee {
  cube: string;
  title: string;
  text: string;
}

export const guarantees: Guarantee[] = [
  {
    cube: 'plain',
    title: 'It never works in your checkout',
    text: 'Every run happens in its own git worktree on its own branch. Your working tree keeps whatever you had open, and a run that goes wrong leaves nothing to clean up but a folder you can delete.',
  },
  {
    cube: 'charcoal',
    title: 'Only one role can write code',
    text: 'Six of the seven roles cannot touch a source file at all: they read artifacts and write documents. Write access is granted per role by the runner, not requested in the prompt, so a role that decides to be helpful still cannot.',
  },
  {
    cube: 'accent',
    title: 'It cannot decide it is done',
    text: 'Pass, retry, or halt is decided outside the model, from the checks it just ran. There is no wording a role can produce that lets it skip a stage, mark its own work approved, or move the run forward on its own say-so.',
  },
  {
    cube: 'sage',
    title: 'Nothing lands half-written',
    text: 'Before code moves on, it is typechecked, linted, and scanned for the tells of an unfinished pass: placeholder bodies, truncation markers, credentials pasted into a file. Any of them sends the work back.',
  },
  {
    cube: 'halt',
    title: 'It cannot skip your hooks',
    text: 'Commits go through your pre-commit hooks like anyone else’s. A hook that rejects the change stops the run. It is never bypassed to keep the pipeline moving.',
  },
  {
    cube: 'slate',
    title: 'It cannot quietly run up a bill',
    text: 'Set a token ceiling, a dollar ceiling, or both. Real spend is tracked across the whole feature, and the run refuses the next call once you are over, rather than telling you afterwards.',
  },
  {
    cube: 'accent',
    title: 'It stops for you, exactly once',
    text: 'No code is written until you have read the plan and said yes. The approval is tied to the plan you actually read, so an Architect that revises it afterwards has to come back and ask again.',
  },
  {
    cube: 'sage',
    title: 'Every commit says who wrote it',
    text: 'Each commit carries the model and the exact prompt behind it. Six months later you can tell which lines came out of which run, and reproduce the conditions that produced them.',
  },
];
