/**
 * The scorer's public surface.
 *
 * In the single-file artifact the scorer was wrapped in an IIFE to keep its
 * primitives from colliding with the OS shell's. Module scope does that now, so
 * the closure is gone — but the isolation it protected is real and still
 * enforced: Card, Btn and Badge exist in both worlds, and everything under
 * scorer/ resolves them to scorer/ui.jsx while the shell resolves them to
 * ui/primitives.jsx.
 *
 * The helpers hung off SCRBRD are attached here rather than in engine.jsx:
 * doing it at the point of assembly keeps engine → seed → charts from becoming
 * an import cycle.
 */
import { SCRBRD } from "./engine.jsx";
import { seedLiveResume, seedCompletedMatch } from "./seed.js";
import { WormChart, ManhattanChart, RunRateChart, BatsmanChart, BowlerChart } from "./charts.jsx";

SCRBRD.seedLiveResume = seedLiveResume;
SCRBRD.seedCompletedMatch = seedCompletedMatch;
SCRBRD.charts = { WormChart, ManhattanChart, RunRateChart, BatsmanChart, BowlerChart };

export default SCRBRD;
