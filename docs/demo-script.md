# Demo script (≈60 seconds)

Use this to record the README GIF or video. Everything shown is real output.

**Setup (off camera)**

```bash
mkdir demo-app && cd demo-app && git init -q
npm init -y >/dev/null && git add . && git commit -qm init
claude plugin install brb@brb   # or: claude --plugin-dir /path/to/brb
```

Use a terminal at least 100 columns wide, with a large font and a dark theme.

**Scene 1: working (15 s)**

```text
claude
> Add src/slugify.js exporting slugify(text): lowercase, spaces to dashes,
  strip non-alphanumerics. Add a test with node:test and run it.
  Next we'll add unicode transliteration.
```

Let Claude create the files and run the test.

**Scene 2: pause (10 s)**

```text
> /brb
```

Pause on the "Checkpoint saved … You can leave now." output. Then exit Claude Code (`/exit`).

**Scene 3: time passes (3 s)**

Show a title card: *"Next morning."* Optionally edit a file by hand to show change detection:

```bash
echo "// reviewed" >> src/slugify.js
```

**Scene 4: resume in a fresh session (20 s)**

```text
claude
> /brb:continue
```

Show "Welcome back!", the task, completed items, the next step, and the repository check that names `src/slugify.js` as edited after the checkpoint. Claude re-reads the file and starts on transliteration.

**Scene 5: end card (5 s)**

> **BRB — You leave. Your context stays.**
> `/plugin marketplace add g4lb/brb-skill`
