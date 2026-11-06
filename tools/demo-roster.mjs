/**
 * The DEMO copy's 330 invented players, by id and place only: school, side,
 * squad number, playing role, batting hand, bowling arm and type, and birth
 * year. NO NAMES — the demo's names live only in its own database (and the
 * 330 file kept out of this repository). Read once from the demo (6 Nov 2026)
 * so tools/demo-season.mjs can pick a side's XI and its bowlers, and
 * tools/demo-replica.mjs can build a local copy at the same ids.
 *
 * Player ids: de300000-0000-4000-8000-000000000NNN, WES 001–165, KEA 166–330.
 * Each boy's verified guardian on the demo is parent.NNN@example.invalid.
 */
export const WES = "22222222-2222-2222-2222-222222222222";
export const KEA = "33333333-3333-3333-3333-333333333333";
export const HIL = "11111111-1111-1111-1111-111111111111";

const RAW = {
  WES: {
    "1XI":  "001:1:bowler:L:R:S:2008 002:2:allrounder:L:R:S:2009 003:3:allrounder:R:R:M:2008 004:4:batter:L:R:-:2009 005:5:batter:R:R:-:2008 006:6:keeper:L:-:-:2008 007:7:batter:R:R:-:2008 008:8:bowler:R:R:F:2009 009:9:batter:R:R:-:2008 010:10:bowler:R:R:S:2008 011:11:batter:R:R:-:2009 012:12:bowler:R:R:M:2008 013:13:allrounder:R:R:M:2009 014:14:batter:R:R:-:2009 015:15:allrounder:R:R:M:2009",
    "2XI":  "016:1:batter:R:R:-:2008 017:2:allrounder:R:R:F:2008 018:3:bowler:R:R:F:2009 019:4:allrounder:L:L:F:2009 020:5:allrounder:R:R:S:2009 021:6:allrounder:R:R:S:2009 022:7:batter:R:L:-:2009 023:8:batter:R:R:-:2008 024:9:batter:R:R:-:2008 025:10:keeper:R:-:-:2008 026:11:bowler:R:R:S:2009 027:12:batter:R:R:-:2008 028:13:bowler:L:R:M:2008 029:14:bowler:R:L:S:2009 030:15:batter:R:R:-:2009",
    "3XI":  "031:1:allrounder:L:R:F:2008 032:2:allrounder:R:R:S:2009 033:3:batter:R:L:-:2008 034:4:batter:R:R:-:2009 035:5:bowler:R:R:M:2008 036:6:allrounder:R:R:F:2008 037:7:batter:L:R:-:2009 038:8:batter:R:R:-:2009 039:9:keeper:R:-:-:2008 040:10:batter:R:R:-:2008 041:11:bowler:L:R:F:2008 042:12:batter:R:R:-:2009 043:13:bowler:R:L:S:2008 044:14:allrounder:L:R:S:2008 045:15:bowler:R:R:S:2008",
    "U16A": "046:1:batter:R:R:-:2010 047:2:bowler:L:R:S:2010 048:3:allrounder:L:R:M:2010 049:4:bowler:R:R:S:2010 050:5:batter:R:R:-:2010 051:6:bowler:R:R:F:2010 052:7:allrounder:R:R:F:2010 053:8:keeper:R:-:-:2010 054:9:allrounder:R:R:F:2010 055:10:allrounder:R:R:S:2010 056:11:batter:R:R:-:2010 057:12:batter:R:R:-:2010 058:13:batter:R:R:-:2010 059:14:bowler:R:L:S:2010 060:15:batter:L:R:-:2010",
    "U16B": "061:1:batter:L:R:-:2010 062:2:allrounder:R:R:S:2010 063:3:bowler:R:R:S:2010 064:4:batter:R:R:-:2010 065:5:keeper:R:-:-:2010 066:6:allrounder:R:R:F:2010 067:7:allrounder:R:R:S:2010 068:8:batter:R:R:-:2010 069:9:bowler:R:R:F:2010 070:10:allrounder:R:R:F:2010 071:11:bowler:R:L:M:2010 072:12:bowler:R:R:M:2010 073:13:batter:R:R:-:2010 074:14:batter:R:L:-:2010 075:15:batter:R:R:-:2010",
    "U15A": "076:1:allrounder:L:L:M:2011 077:2:batter:R:L:-:2011 078:3:allrounder:R:R:S:2011 079:4:bowler:R:R:M:2011 080:5:bowler:R:R:M:2011 081:6:allrounder:R:R:M:2011 082:7:batter:R:L:-:2011 083:8:allrounder:R:R:S:2011 084:9:bowler:R:R:M:2011 085:10:bowler:L:R:F:2011 086:11:batter:R:L:-:2011 087:12:batter:L:L:-:2011 088:13:keeper:R:-:-:2011 089:14:batter:R:R:-:2011 090:15:batter:R:R:-:2011",
    "U15B": "091:1:keeper:R:-:-:2011 092:2:allrounder:R:R:F:2011 093:3:bowler:R:R:S:2011 094:4:batter:R:R:-:2011 095:5:batter:R:R:-:2011 096:6:bowler:R:L:M:2011 097:7:allrounder:L:R:F:2011 098:8:allrounder:R:R:F:2011 099:9:bowler:R:R:M:2011 100:10:bowler:R:R:F:2011 101:11:batter:R:R:-:2011 102:12:batter:R:R:-:2011 103:13:batter:L:R:-:2011 104:14:allrounder:R:R:M:2011 105:15:batter:R:R:-:2011",
    "U14A": "106:1:batter:R:R:-:2012 107:2:allrounder:R:R:S:2012 108:3:bowler:R:R:F:2012 109:4:keeper:R:-:-:2012 110:5:batter:L:L:-:2012 111:6:bowler:R:R:F:2012 112:7:batter:R:R:-:2012 113:8:batter:R:R:-:2012 114:9:bowler:R:R:S:2012 115:10:batter:R:R:-:2012 116:11:bowler:R:R:F:2012 117:12:allrounder:R:L:S:2012 118:13:allrounder:R:L:M:2012 119:14:batter:R:R:-:2012 120:15:allrounder:L:R:M:2012",
    "U14B": "121:1:bowler:R:R:S:2012 122:2:batter:L:R:-:2012 123:3:allrounder:R:R:F:2012 124:4:batter:R:R:-:2012 125:5:batter:L:R:-:2012 126:6:keeper:R:-:-:2012 127:7:bowler:R:R:F:2012 128:8:bowler:L:R:S:2012 129:9:batter:R:R:-:2012 130:10:allrounder:R:R:S:2012 131:11:allrounder:R:R:F:2012 132:12:allrounder:R:R:F:2012 133:13:batter:R:R:-:2012 134:14:bowler:R:R:S:2012 135:15:batter:R:R:-:2012",
    "U13A": "136:1:allrounder:R:R:M:2013 137:2:batter:R:R:-:2013 138:3:batter:R:R:-:2013 139:4:batter:R:R:-:2013 140:5:bowler:R:L:S:2013 141:6:bowler:R:R:M:2013 142:7:allrounder:R:R:S:2013 143:8:batter:R:R:-:2013 144:9:keeper:R:-:-:2013 145:10:allrounder:R:R:S:2013 146:11:bowler:R:R:S:2013 147:12:batter:L:R:-:2013 148:13:bowler:R:R:F:2013 149:14:allrounder:R:R:F:2013 150:15:batter:R:R:-:2013",
    "U12A": "151:1:allrounder:R:R:F:2014 152:2:keeper:R:-:-:2014 153:3:batter:R:R:-:2014 154:4:allrounder:R:R:M:2014 155:5:batter:R:R:-:2014 156:6:bowler:R:R:F:2014 157:7:bowler:R:L:F:2014 158:8:allrounder:R:R:S:2014 159:9:batter:R:R:-:2014 160:10:batter:R:R:-:2014 161:11:bowler:R:R:F:2014 162:12:batter:R:L:-:2014 163:13:allrounder:R:R:F:2014 164:14:batter:R:R:-:2014 165:15:bowler:R:L:F:2014",
  },
  KEA: {
    "1XI":  "166:1:batter:L:L:-:2009 167:2:allrounder:R:R:S:2009 168:3:allrounder:R:R:F:2009 169:4:batter:R:L:-:2008 170:5:bowler:L:R:M:2008 171:6:bowler:R:R:F:2009 172:7:allrounder:R:R:S:2009 173:8:bowler:L:R:S:2009 174:9:bowler:R:R:S:2009 175:10:batter:R:R:-:2009 176:11:keeper:R:-:-:2009 177:12:batter:R:R:-:2009 178:13:batter:R:R:-:2009 179:14:allrounder:R:R:S:2009 180:15:batter:R:R:-:2009",
    "2XI":  "181:1:bowler:R:R:M:2009 182:2:bowler:L:R:S:2009 183:3:keeper:R:-:-:2008 184:4:batter:L:R:-:2008 185:5:allrounder:R:R:S:2009 186:6:batter:R:R:-:2008 187:7:batter:R:R:-:2009 188:8:allrounder:R:R:F:2009 189:9:batter:R:R:-:2008 190:10:bowler:R:L:M:2008 191:11:allrounder:R:L:M:2008 192:12:batter:R:R:-:2009 193:13:batter:R:R:-:2008 194:14:allrounder:R:R:F:2008 195:15:bowler:R:R:F:2009",
    "3XI":  "196:1:batter:R:R:-:2009 197:2:allrounder:R:R:F:2009 198:3:allrounder:R:R:F:2009 199:4:batter:R:R:-:2009 200:5:batter:R:R:-:2008 201:6:batter:L:R:-:2009 202:7:keeper:R:-:-:2009 203:8:allrounder:R:R:S:2008 204:9:bowler:R:R:S:2008 205:10:batter:R:R:-:2008 206:11:bowler:R:L:S:2008 207:12:bowler:L:R:M:2009 208:13:bowler:R:R:M:2008 209:14:batter:L:R:-:2009 210:15:allrounder:R:R:M:2008",
    "U16A": "211:1:bowler:R:R:M:2010 212:2:batter:R:R:-:2010 213:3:bowler:L:R:M:2010 214:4:batter:R:R:-:2010 215:5:batter:R:R:-:2010 216:6:bowler:R:R:S:2010 217:7:keeper:R:-:-:2010 218:8:allrounder:R:R:S:2010 219:9:allrounder:R:R:S:2010 220:10:allrounder:R:L:F:2010 221:11:batter:R:R:-:2010 222:12:allrounder:R:R:F:2010 223:13:batter:R:R:-:2010 224:14:bowler:R:R:M:2010 225:15:batter:R:R:-:2010",
    "U16B": "226:1:batter:R:R:-:2010 227:2:batter:R:R:-:2010 228:3:allrounder:L:R:M:2010 229:4:batter:R:R:-:2010 230:5:bowler:R:R:S:2010 231:6:batter:R:R:-:2010 232:7:keeper:R:-:-:2010 233:8:allrounder:R:R:F:2010 234:9:batter:L:R:-:2010 235:10:bowler:R:L:F:2010 236:11:allrounder:R:R:S:2010 237:12:batter:R:L:-:2010 238:13:bowler:R:R:F:2010 239:14:bowler:R:R:F:2010 240:15:allrounder:L:R:F:2010",
    "U15A": "241:1:bowler:R:R:S:2011 242:2:batter:R:R:-:2011 243:3:bowler:R:R:F:2011 244:4:allrounder:R:R:M:2011 245:5:batter:R:R:-:2011 246:6:batter:L:L:-:2011 247:7:keeper:L:-:-:2011 248:8:batter:L:R:-:2011 249:9:allrounder:R:R:S:2011 250:10:batter:L:R:-:2011 251:11:allrounder:R:R:F:2011 252:12:bowler:R:R:S:2011 253:13:batter:R:R:-:2011 254:14:bowler:R:R:S:2011 255:15:allrounder:R:R:S:2011",
    "U15B": "256:1:batter:R:R:-:2011 257:2:allrounder:L:R:S:2011 258:3:bowler:R:R:F:2011 259:4:allrounder:R:R:F:2011 260:5:allrounder:R:R:S:2011 261:6:bowler:R:R:F:2011 262:7:batter:L:R:-:2011 263:8:bowler:R:R:F:2011 264:9:bowler:L:R:M:2011 265:10:batter:R:R:-:2011 266:11:batter:R:L:-:2011 267:12:keeper:R:-:-:2011 268:13:batter:R:L:-:2011 269:14:batter:R:R:-:2011 270:15:allrounder:R:R:S:2011",
    "U14A": "271:1:batter:R:R:-:2012 272:2:batter:R:R:-:2012 273:3:bowler:L:R:S:2012 274:4:batter:R:R:-:2012 275:5:batter:R:L:-:2012 276:6:bowler:R:R:S:2012 277:7:allrounder:R:L:M:2012 278:8:allrounder:R:L:M:2012 279:9:allrounder:R:R:S:2012 280:10:batter:R:R:-:2012 281:11:keeper:R:-:-:2012 282:12:batter:R:R:-:2012 283:13:allrounder:R:L:M:2012 284:14:bowler:R:R:M:2012 285:15:bowler:R:R:F:2012",
    "U14B": "286:1:allrounder:R:R:F:2012 287:2:batter:R:R:-:2012 288:3:batter:R:R:-:2012 289:4:bowler:R:R:S:2012 290:5:batter:R:R:-:2012 291:6:bowler:R:R:F:2012 292:7:bowler:R:L:F:2012 293:8:keeper:R:-:-:2012 294:9:batter:L:R:-:2012 295:10:bowler:R:L:S:2012 296:11:allrounder:R:R:M:2012 297:12:allrounder:R:R:S:2012 298:13:batter:R:R:-:2012 299:14:batter:R:L:-:2012 300:15:allrounder:L:R:M:2012",
    "U13A": "301:1:allrounder:R:R:F:2013 302:2:batter:R:R:-:2013 303:3:allrounder:L:R:S:2013 304:4:batter:L:R:-:2013 305:5:batter:R:R:-:2013 306:6:keeper:R:-:-:2013 307:7:batter:R:R:-:2013 308:8:bowler:R:R:S:2013 309:9:bowler:L:R:S:2013 310:10:allrounder:R:R:S:2013 311:11:allrounder:R:R:S:2013 312:12:bowler:R:R:M:2013 313:13:batter:L:L:-:2013 314:14:bowler:R:R:S:2013 315:15:batter:L:R:-:2013",
    "U12A": "316:1:keeper:R:-:-:2014 317:2:allrounder:R:R:F:2014 318:3:batter:R:R:-:2014 319:4:bowler:R:R:M:2014 320:5:allrounder:R:R:S:2014 321:6:bowler:R:R:M:2014 322:7:bowler:L:R:M:2014 323:8:allrounder:R:R:F:2014 324:9:bowler:L:R:S:2014 325:10:batter:L:R:-:2014 326:11:batter:R:R:-:2014 327:12:batter:R:R:-:2014 328:13:allrounder:R:R:F:2014 329:14:batter:R:R:-:2014 330:15:batter:L:R:-:2014",
  },
};

export const SIDES = ["1XI", "2XI", "3XI", "U16A", "U16B", "U15A", "U15B", "U14A", "U14B", "U13A", "U12A"];
export const pid = (n) => `de300000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/**
 * @typedef {{n: number, id: string, school: string, code: string, team: string, squad: number,
 *            role: string, bat: string|null, arm: string|null, bowl: string|null, year: number}} RosterBoy
 * @type {RosterBoy[]}
 */
export const ROSTER = [];
for (const [code, sides] of Object.entries(RAW)) {
  for (const [team, line] of Object.entries(sides)) {
    for (const cell of line.split(" ")) {
      const [n, squad, role, bat, arm, bowl, year] = cell.split(":");
      const nil = (v) => (v === "-" ? null : v);
      ROSTER.push({ n: Number(n), id: pid(Number(n)), school: code === "WES" ? WES : KEA, code, team, squad: Number(squad),
        role, bat: nil(bat), arm: nil(arm), bowl: nil(bowl), year: Number(year) });
    }
  }
}

/** A side's boys, in squad order. @param {"WES"|"KEA"} code @param {string} team */
export const sideOf = (code, team) => ROSTER.filter((b) => b.code === code && b.team === team).sort((a, b) => a.squad - b.squad);
