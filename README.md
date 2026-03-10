# Claude Code Status Line

<img width="420" alt="screenshot" src="https://github.com/user-attachments/assets/38b8647e-02c7-4a9c-abde-cec842c816d6" />

## Install

1. Install [Bun](https://bun.sh)
2. Clone this repo and install dependencies:
   ```sh
   git clone https://github.com/davidbuezas/claude-statusline-command.git ~/.claude/statusline-command
   cd ~/.claude/statusline-command
   bun install
   ```
3. Add to `~/.claude/settings.json`:
   ```json
   {
     "statusLineCommand": "bun run ~/.claude/statusline-command"
   }
   ```
