# Third-party skills

Copied 2026-10-07 at Kameel's request. Each is MIT licensed, except the Android skills (Apache 2.0); the licence is
kept beside each skill as `LICENSE.upstream`. Per-tool `agents/` configs from
the upstream repositories were not copied.

| Skills | Repository | Commit |
|---|---|---|
| animate, animate-expo, animation-vocabulary, apple-design, ask-sonner, break-ui, emil-design-eng, find-animation-opportunities, improve-animations, mobile-native, pick-ui-library, prototype, review-animations, write-swift | https://github.com/emilkowalski/skills | e8a175d |
| better-accessibility, better-colors, better-interface, better-layout, better-typography, better-ui, better-writing, break, build-design, explain-interface, interface-review, state-machine, variant | https://github.com/jakubkrehel/skills | d574cc8 |
| landing-page-design | https://github.com/elayadesign/ai-design-skills | 1c1e97c |
| tastemaker, ideagram | https://github.com/codeswithroh/tastemaker | e39b4bf |
| stageshow (v1.1.1; MIT, with its own `NOTICE.md` for the bundled brand icons and app artwork) | https://github.com/benjitaylor/skills (`stageshow/`) | 299140f (added 7 Nov 2026) |
| ponytail, ponytail-audit, ponytail-debt, ponytail-gain, ponytail-help, ponytail-review | https://github.com/DietrichGebert/ponytail (`skills/`; the plugin's hooks and band were not copied) | 09c434a (updated 21 Oct 2026) |
| edge-to-edge, android-intent-security, android-permissions-security, play-policy-insights, android-cli, testing-setup | https://github.com/android/skills (Apache 2.0; added 27 Oct 2026, the six a Capacitor shell would use; the other 30 native-app skills were not copied) | 45fd173 |

To update one: clone the repository, read the diff, and copy the skill's
directory over this one.

## Uploaded skills

| Skill | Source | Added |
|---|---|---|
| saas-animation | Uploaded by Kameel as `saas-animation.skill` (sha256 `b1c99cf6…0baf`). No upstream repository or licence came with it. | 2026-11-06 |

saas-animation's scripts call only ffmpeg and a local Chrome on 127.0.0.1, and
its templates load only their own scripts. Its rules on children's photos,
names and claims are weaker than `docs/policy/PUBLIC_DATA.md`; this
repository's rules win, as for every design skill (CLAUDE.md).
