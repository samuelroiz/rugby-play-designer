# rugby-play-writer

Skill that writes play .json files for the Rugby Play Designer (https://playbook.samuelroiz.com,
repo: samuelroiz/rugby-play-designer). Start at SKILL.md; the format rules live in
references/ai-play-guide.md (the live copy at playbook.samuelroiz.com/docs/AI_PLAY_GUIDE.md wins).

Working on a play:
- node scripts/build_phases.mjs play.json      # recompute later phases with the app's rules
- node scripts/validate_play.mjs play.json --repo <path to rugby-play-designer checkout>

scripts/play-model.mjs is a port of the app's js/model.js, js/animate.js and js/phases.js
(commit 28f0659). If the app's rules change, re-port those files; don't change the logic here
on its own. assets/templates and references/ai-play-guide.md are copies from the same commit -
refresh them together. Keep scripts dependency-free (plain Node, no npm packages): the skill
runs where nothing is installed.
