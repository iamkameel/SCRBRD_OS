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
| ponytail, ponytail-audit, ponytail-debt, ponytail-gain, ponytail-help, ponytail-review | https://github.com/DietrichGebert/ponytail (`skills/`; the plugin's hooks and band were not copied) | 09c434a (updated 21 Oct 2026) |
| edge-to-edge, android-intent-security, android-permissions-security, play-policy-insights, android-cli, testing-setup | https://github.com/android/skills (Apache 2.0; added 27 Oct 2026, the six a Capacitor shell would use; the other 30 native-app skills were not copied) | 45fd173 |
| stageshow | https://github.com/benjitaylor/skills (`stageshow/`; MIT; added 11 Nov 2026 at Kameel's request. The unlicensed app icons and the official Linear, American Express and Circle logos were removed from this copy on 11 Nov (see its `NOTICE.md`); its own `package.json` is not part of this workspace and adds no dependency to the app) | 299140f |
| banner-design, brand, design, design-system, slides, ui-styling, ui-ux-pro-max | https://github.com/nextlevelbuilder/ui-ux-pro-max-skill (`.claude/skills/`; MIT; added 19 Nov 2026 at Kameel's request) | 2de1134 |
| impeccable | https://github.com/pbakaus/impeccable (`.claude/skills/impeccable`; Apache 2.0, its NOTICE kept as `NOTICE.upstream.md`; added 19 Nov 2026) | b49177d |
| baseline-ui, component-canvas, create-canvas, create-design-md, device-frames, fixing-accessibility, fixing-metadata, fixing-motion-performance, improve-ui, ui-skills-root | https://github.com/ibelick/ui-skills (`skills/`; MIT; added 19 Nov 2026) | 347d318 |
| composition-patterns, react-best-practices, react-native-skills, react-view-transitions, web-design-guidelines, writing-guidelines | https://github.com/vercel-labs/agent-skills (`skills/`; MIT; added 19 Nov 2026. Not copied: deploy-to-vercel, vercel-cli-with-tokens and vercel-optimize, because production is on Render, and the `.zip` bundles) | 1a2c79d |
| academy-guide, algorithmic-art, canvas-design, discernment-nudge, doc-coauthoring, frontend-design, internal-comms, mcp-builder, slack-gif-creator, theme-factory, web-artifacts-builder, webapp-testing | https://github.com/anthropics/skills (`skills/`; Apache 2.0; added 19 Nov 2026. Not copied: claude-api, skill-creator, docx, pdf, pptx and xlsx, which every session already has, and brand-guidelines, which applies Anthropic's own brand) | e4bb5d9 |

To update one: clone the repository, read the diff, and copy the skill's
directory over this one.
