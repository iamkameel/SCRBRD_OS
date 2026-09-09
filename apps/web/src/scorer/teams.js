import { D } from "../design/tokens.js";

/* ═══════════════════════════════════════════════════════
   SETUP SCREEN — with full squad entry
═══════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════
   INTERNATIONAL TEAMS DATABASE
═══════════════════════════════════════════════════════ */
const INT_TEAMS = {
  "Australia": {
    flag:"🇦🇺", abbr:"AUS", accent:"#f4c430",
    players:[
      {name:"David Warner",    role:"BAT",  bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"F"},
      {name:"Usman Khawaja",   role:"BAT",  bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"M"},
      {name:"Marnus Labuschagne",role:"BAT",bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Steve Smith",     role:"BAT",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Travis Head",     role:"BAT",  bat:true,  bowl:true, batHand:"L", bowlArm:"R", bowlStyle:"S"},
      {name:"Mitchell Marsh",  role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Alex Carey",      role:"WK",   bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"M"},
      {name:"Pat Cummins",     role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Mitchell Starc",  role:"BOWL", bat:false, bowl:true, batHand:"L", bowlArm:"L", bowlStyle:"F"},
      {name:"Josh Hazlewood",  role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Adam Zampa",      role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Cameron Green",   role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Marcus Stoinis",  role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Matthew Wade",    role:"WK",   bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"M"},
      {name:"Nathan Lyon",     role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
    ]
  },
  "England": {
    flag:"🏴󠁧󠁢󠁥󠁮󠁧󠁿", abbr:"ENG", accent:"#003580",
    players:[
      {name:"Zak Crawley",     role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Ben Duckett",     role:"BAT",  bat:true,  bowl:false, batHand:"L", bowlArm:"L", bowlStyle:"M"},
      {name:"Ollie Pope",      role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Joe Root",        role:"BAT",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Harry Brook",     role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Ben Stokes",      role:"ALL",  bat:true,  bowl:true, batHand:"L", bowlArm:"R", bowlStyle:"F"},
      {name:"Jonny Bairstow",  role:"WK",   bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Chris Woakes",    role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Gus Atkinson",    role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Stuart Broad",    role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"James Anderson",  role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Mark Wood",       role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Brydon Carse",    role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Moeen Ali",       role:"ALL",  bat:true,  bowl:true, batHand:"L", bowlArm:"R", bowlStyle:"S"},
      {name:"Jos Buttler",     role:"WK",   bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
    ]
  },
  "India": {
    flag:"🇮🇳", abbr:"IND", accent:"#ff9933",
    players:[
      {name:"Rohit Sharma",    role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Shubman Gill",    role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Virat Kohli",     role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Shreyas Iyer",    role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"KL Rahul",        role:"WK",   bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Hardik Pandya",   role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Ravindra Jadeja", role:"ALL",  bat:true,  bowl:true, batHand:"L", bowlArm:"L", bowlStyle:"S"},
      {name:"Jasprit Bumrah",  role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Mohammed Shami",  role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Mohammed Siraj",  role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Kuldeep Yadav",   role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"L", bowlStyle:"S"},
      {name:"Rishabh Pant",    role:"WK",   bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"M"},
      {name:"Axar Patel",      role:"ALL",  bat:true,  bowl:true, batHand:"L", bowlArm:"L", bowlStyle:"S"},
      {name:"Yashasvi Jaiswal",role:"BAT",  bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"S"},
      {name:"Arshdeep Singh",  role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
    ]
  },
  "South Africa": {
    flag:"🇿🇦", abbr:"RSA", accent:"#007a4d",
    players:[
      {name:"Reeza Hendricks",  role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Quinton de Kock",  role:"WK",   bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"M"},
      {name:"Aiden Markram",    role:"BAT",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Rassie van der Dussen",role:"BAT",bat:true,bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"David Miller",     role:"BAT",  bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"M"},
      {name:"Heinrich Klaasen", role:"WK",   bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Marco Jansen",     role:"ALL",  bat:true,  bowl:true, batHand:"L", bowlArm:"L", bowlStyle:"F"},
      {name:"Keshav Maharaj",   role:"ALL",  bat:false, bowl:true, batHand:"R", bowlArm:"L", bowlStyle:"S"},
      {name:"Kagiso Rabada",    role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Lungi Ngidi",      role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Tabraiz Shamsi",   role:"BOWL", bat:false, bowl:true, batHand:"L", bowlArm:"L", bowlStyle:"S"},
      {name:"Anrich Nortje",    role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Ryan Rickelton",   role:"BAT",  bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"M"},
      {name:"Tony de Zorzi",    role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Gerald Coetzee",   role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
    ]
  },
  "New Zealand": {
    flag:"🇳🇿", abbr:"NZL", accent:"#000000",
    players:[
      {name:"Devon Conway",     role:"WK",   bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"M"},
      {name:"Will Young",       role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Kane Williamson",  role:"BAT",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Daryl Mitchell",   role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Tom Latham",       role:"WK",   bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"M"},
      {name:"Glenn Phillips",   role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Michael Bracewell",role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Mitchell Santner", role:"ALL",  bat:false, bowl:true, batHand:"L", bowlArm:"L", bowlStyle:"S"},
      {name:"Tim Southee",      role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Trent Boult",      role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"L", bowlStyle:"F"},
      {name:"Matt Henry",       role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Lockie Ferguson",  role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Rachin Ravindra",  role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Mark Chapman",     role:"BAT",  bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"S"},
      {name:"Ish Sodhi",        role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
    ]
  },
  "Pakistan": {
    flag:"🇵🇰", abbr:"PAK", accent:"#01411c",
    players:[
      {name:"Mohammad Rizwan",  role:"WK",   bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Saim Ayub",        role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Babar Azam",       role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Saud Shakeel",     role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Mohammad Haris",   role:"WK",   bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Iftikhar Ahmed",   role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Shadab Khan",      role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Shaheen Afridi",   role:"BOWL", bat:false, bowl:true, batHand:"L", bowlArm:"L", bowlStyle:"F"},
      {name:"Naseem Shah",      role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Haris Rauf",       role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Abrar Ahmed",      role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Fakhar Zaman",     role:"BAT",  bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"M"},
      {name:"Agha Salman",      role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Usama Mir",        role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Abdullah Shafique",role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"F"},
    ]
  },
  "West Indies": {
    flag:"🏏", abbr:"WI", accent:"#7b0c0c",
    players:[
      {name:"Brandon King",     role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Kyle Mayers",      role:"ALL",  bat:true,  bowl:true, batHand:"L", bowlArm:"R", bowlStyle:"F"},
      {name:"Shai Hope",        role:"WK",   bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Nicholas Pooran",  role:"WK",   bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"M"},
      {name:"Shimron Hetmyer",  role:"BAT",  bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"M"},
      {name:"Rovman Powell",    role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Jason Holder",     role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Gudakesh Motie",   role:"BOWL", bat:false, bowl:true, batHand:"L", bowlArm:"L", bowlStyle:"S"},
      {name:"Alzarri Joseph",   role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Shamar Joseph",    role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Akeal Hosein",     role:"BOWL", bat:false, bowl:true, batHand:"L", bowlArm:"L", bowlStyle:"S"},
      {name:"Yannic Cariah",    role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Johnson Charles",  role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Romario Shepherd", role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Kevin Sinclair",   role:"ALL",  bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
    ]
  },
  "Sri Lanka": {
    flag:"🇱🇰", abbr:"SL", accent:"#8b0000",
    players:[
      {name:"Pathum Nissanka",  role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Dimuth Karunaratne",role:"BAT", bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"F"},
      {name:"Kusal Mendis",     role:"WK",   bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Angelo Mathews",   role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Dhananjaya de Silva",role:"ALL",bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Charith Asalanka", role:"BAT",  bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"S"},
      {name:"Dasun Shanaka",    role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Wanindu Hasaranga",role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Maheesh Theekshana",role:"BOWL",bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Dushmantha Chameera",role:"BOWL",bat:false,bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Kasun Rajitha",    role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Lahiru Kumara",    role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Janith Liyanage",  role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Asitha Fernando",  role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Jeffrey Vandersay",role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
    ]
  },
  "Bangladesh": {
    flag:"🇧🇩", abbr:"BAN", accent:"#006a4e",
    players:[
      {name:"Litton Das",       role:"WK",   bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Tanzid Hasan",     role:"BAT",  bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"M"},
      {name:"Najmul Hossain",   role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Shakib Al Hasan",  role:"ALL",  bat:true,  bowl:true, batHand:"L", bowlArm:"L", bowlStyle:"S"},
      {name:"Mushfiqur Rahim",  role:"WK",   bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Towhid Hridoy",    role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Mahmudullah",      role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Mehidy Hasan",     role:"ALL",  bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Taskin Ahmed",     role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Mustafizur Rahman",role:"BOWL", bat:false, bowl:true, batHand:"L", bowlArm:"L", bowlStyle:"F"},
      {name:"Shoriful Islam",   role:"BOWL", bat:false, bowl:true, batHand:"L", bowlArm:"L", bowlStyle:"F"},
      {name:"Rishad Hossain",   role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Nazmul Hossain",   role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Afif Hossain",     role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Hasan Mahmud",     role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
    ]
  },
  "Afghanistan": {
    flag:"🇦🇫", abbr:"AFG", accent:"#000087",
    players:[
      {name:"Rahmanullah Gurbaz",role:"WK",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Ibrahim Zadran",   role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Rahmat Shah",      role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Hashmatullah Shahidi",role:"BAT",bat:true, bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"M"},
      {name:"Mohammad Nabi",    role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Azmatullah Omarzai",role:"ALL", bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Ikram Alikhil",    role:"WK",   bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"M"},
      {name:"Rashid Khan",      role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Mujeeb ur Rahman", role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Fazalhaq Farooqi", role:"BOWL", bat:false, bowl:true, batHand:"L", bowlArm:"L", bowlStyle:"F"},
      {name:"Naveen ul Haq",    role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Noor Ahmad",       role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Gulbadin Naib",    role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Karim Janat",      role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Qais Ahmad",       role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
    ]
  },
  "Zimbabwe": {
    flag:"🇿🇼", abbr:"ZIM", accent:"#009a44",
    players:[
      {name:"Craig Ervine",     role:"BAT",  bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"M"},
      {name:"Takudzwanashe Kaitano",role:"BAT",bat:true,bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Sean Williams",    role:"ALL",  bat:true,  bowl:true, batHand:"L", bowlArm:"L", bowlStyle:"S"},
      {name:"Sikandar Raza",    role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Regis Chakabva",   role:"WK",   bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Milton Shumba",    role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Ryan Burl",        role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Wellington Masakadza",role:"BOWL",bat:false,bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Tendai Chatara",   role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Blessing Muzarabani",role:"BOWL",bat:false,bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Victor Nyauchi",   role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Luke Jongwe",      role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Brian Bennett",    role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Joylord Gumbie",   role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Clive Madande",    role:"WK",   bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
    ]
  },
  "Ireland": {
    flag:"🇮🇪", abbr:"IRE", accent:"#169b62",
    players:[
      {name:"Paul Stirling",    role:"BAT",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Andrew Balbirnie", role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Lorcan Tucker",    role:"WK",   bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Harry Tector",     role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"George Dockrell",  role:"ALL",  bat:true,  bowl:true, batHand:"L", bowlArm:"R", bowlStyle:"S"},
      {name:"Curtis Campher",   role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Lorcan Tucker",    role:"WK",   bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Andy McBrine",     role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Mark Adair",       role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Barry McCarthy",   role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Josh Little",      role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"L", bowlStyle:"F"},
      {name:"Craig Young",      role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Fionn Hand",       role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Trent Johnston",   role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Neil Rock",        role:"WK",   bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
    ]
  },
};

const ROLE_COLORS = {
  BAT: D.sky, WK: D.emerald, ALL: D.amber, BOWL: D.orange,
};

const ROLE_LABELS = {
  BAT:"Batter", WK:"Wicket-keeper", ALL:"All-rounder", BOWL:"Bowler",
};

export { INT_TEAMS, ROLE_COLORS, ROLE_LABELS };
