// Everything the landing page says: wording, links, lists and the showcase maps.
// Edit this file to change the page; landing.js only lays it out.

export const BRAND = {
  name: "IndoorWay",
  company: "SrcDrive",
  logo: "indoorway-logo.svg",
  email: "contact@srcdrive.com",
  location: "Dhaka, Bangladesh",
  // Office address shown in the footer (as published on srcdrive.com).
  city: "Dhaka",
  address: ["13-H Topkhana Road", "Rupayan Lotus, Flat 18/C", "Segunbagicha, Dhaka-1000", "Bangladesh"]
};

export const SOCIAL = [
  { id: "web", label: "SrcDrive website", short: "Website", icon: "globe", url: "https://srcdrive.com/" },
  { id: "linkedin", label: "SrcDrive on LinkedIn", short: "LinkedIn", icon: "linkedin", url: "https://www.linkedin.com/company/srcdrivebd/" },
  { id: "facebook", label: "SrcDrive on Facebook", short: "Facebook", icon: "facebook", url: "https://www.facebook.com/profile.php?id=61594760757019" }
];

export const HERO = {
  title: "Indoor Navigation",
  byline: "by SrcDrive",
  lead: "Accurate, interactive, turn by turn indoor navigation that makes every journey simple and seamless.",
  text: "Enhance visitor experiences, simplify wayfinding and unlock greater value from every space.",
  // The row under the text: the label, the three social icons and an arrow to the demo form.
  talk: "Talk to us"
};

// The first page, under the hero: a picture of the map on a laptop and a phone,
// a headline, then one card that shows the features one at a time (text on the
// left, picture on the right; arrows and dots change the feature). `file` names
// the artwork, public/image/ui/<file>.svg; the page shows the light copies made
// from it by `npm run landing:images`.
//   seconds   the card moves to the next feature by itself after this many
//             seconds, until the visitor uses the arrows or dots (0: never)
//   eyebrow   small line above the title (optional)
//   lead      line under the title (optional)
//   closing   line under the list (optional)
export const FEATURES = {
  picture: { file: "a", alt: "The BCSIR campus map open on a laptop and on a phone" },
  title: "Maps that know the inside of the building.",
  seconds: 7,
  previous: "Previous feature",
  next: "Next feature",
  items: [
    {
      id: "building",
      file: "3dbuilding",
      alt: "A phone showing the campus buildings in 3D",
      title: "3D Building Experience",
      lead: "Explore your campus in an immersive 3D view",
      points: [
        "Realistic 3D building visualization",
        "Interactive buildings with detailed floor information",
        "Easy identification of facilities, rooms and landmarks",
        "Seamless navigation across complex spaces"
      ],
      closing: "Bring your buildings to life with interactive 3D mapping"
    },
    {
      id: "walkthrough",
      file: "game",
      alt: "A walk through the campus in 3D, on a desktop screen and on a phone",
      eyebrow: "Gamer Style",
      title: "Interactive 3D Walkthrough",
      lead: "Play through your campus in full 3D",
      points: [
        "Game ready 3D building models",
        "Click to explore buildings with full floor breakdowns",
        "Easy quest style discovery of rooms, amenities, and key spots",
        "Smooth open map roaming across every level"
      ]
    },
    {
      id: "route",
      file: "route",
      alt: "A walking route and its time, on a laptop and on a phone",
      title: "Smart Route & Time Planning",
      lead: "Navigate your campus with optimized paths and precise arrival estimates",
      points: [
        "Turn by turn route planning for indoor and outdoor campus spaces",
        "Accurate distance calculations across floors, elevators, and hallways",
        "Real time travel time estimates tailored to walking speed and accessible routes",
        "Dynamic step by step guidance to prevent wrong turns and delays"
      ]
    },
    {
      id: "indoor",
      file: "indoor",
      alt: "A route across a floor plan, on a laptop and on a phone",
      // The title is the one written on the artwork.
      title: "Indoor Multifloor Wayfinding",
      points: [
        "Interactive building selection with detailed indoor floor layouts",
        "Full indoor mapping of rooms, offices, amenities, and key facilities",
        "Integrated vertical circulation tracking across stairs, escalators, and elevators",
        "Seamless multi floor route guidance with step by step indoor directions"
      ]
    }
  ]
};

export const SOLUTIONS = {
  eyebrow: "Solutions",
  title: "One platform for every indoor journey",
  lead: "Start with a clear map of your building and add navigation and tracking when you need them.",
  items: [
    { id: "indoor-map", icon: "map", title: "Indoor Map", text: "Clear digital floor plans of every building and every floor, with rooms named and easy to search." },
    { id: "indoor-navigation", icon: "route", title: "Indoor Navigation", text: "Step by step directions from any place to any other, across floors, by stairs or by lift." },
    { id: "indoor-tracking", icon: "target", title: "Indoor Tracking", text: "See where people and assets are inside your venue, shown live on the map." },
    { id: "maps-3d-2d", icon: "cube", title: "3D and 2D Maps", text: "Maps, navigation and tracking in a realistic 3D view or a simple 2D plan, whichever suits your visitors." }
  ]
};

// A mark such as "*" at the end of a feature points to the note with the same mark.
// A note left empty is not printed.
export const FOOTNOTES = {
  "*": "POI means point of interest.",
  "**": ""
};

// Each showcase map is one of the maps of this site, opened in a frame.
//   org     folder name in public/data/
//   query   extra address switches (view=2d shows any map flat)
//   locked  true: only a blurred picture with a lock is shown; the map is not loaded
// The Basic map is the organisation "bcsir-2d": the flat QGIS data, brought in from
// its own repository with `npm run data:pull-2d`.
export const SHOWCASE = {
  eyebrow: "Showcase",
  title: "3D interactive maps",
  lead: "Explore our live maps right here in your browser. There is nothing to install.",
  start: "Explore the live map",
  resume: "Click to use the map",
  fullscreen: "Full screen",
  exitFullscreen: "Exit full screen",
  newTab: "Open in a new tab",
  locked: "Locked",
  items: [
    {
      id: "taqwa-3d",
      org: "taqwafabrics",
      query: "",
      locked: true,
      tier: "Premium",
      name: "Taqwa Fabrics, Gazipur",
      kind: "3D map",
      poster: "landing/taqwa-3d.webp",
      features: [
        "Everything in Standard",
        "Simulated walk through for training / demos",
        "Detailed room / floor 3D view with components**",
        "Components with audio and video description",
        "AR camera navigation (Android, ARCore)",
        "AI navigator**"
      ]
    },
    {
      id: "bcsir-3d",
      org: "bcsir",
      query: "",
      tier: "Standard",
      name: "BCSIR campus, Dhaka",
      kind: "3D map",
      poster: "landing/bcsir-3d.webp",
      features: [
        "Everything in Basic",
        "3D building and floor view",
        "3D navigation between any two places",
        "Vertical navigation across multi storey buildings (doors, stairs, elevators)",
        "Stair / lift preference (fastest, lift, stairs)",
        "Tap a room on the map to set From / To",
        "Accessible pathways for people with special needs (e.g. wheelchair)",
        "Audio based short description of each POI"
      ]
    },
    {
      id: "bcsir-2d",
      org: "bcsir-2d",
      query: "",
      tier: "Basic",
      name: "BCSIR campus, Dhaka",
      kind: "2D map",
      poster: "landing/bcsir-2d.webp",
      features: [
        "2D digital floor plans for every floor",
        "Rooms named and colour coded by use",
        "Search any POI*",
        "2D navigation between two places",
        "Floor switcher (G to top floor)",
        "Web and mobile map view",
        "QR code based quick navigation link",
        "Shortest route calculation",
        "Text based short description of each POI",
        "2D acrylic board map**"
      ]
    }
  ]
};

export const INDUSTRIES = {
  eyebrow: "Industries",
  title: "Built for the places where people need to find their way",
  lead: "Every venue is different. IndoorWay adapts to yours.",
  items: [
    { icon: "bag", title: "Retail", text: "Help shoppers find stores, offers and services quickly." },
    { icon: "hospital", title: "Hospitals", text: "Guide patients and visitors to the right ward, clinic or desk." },
    { icon: "shield", title: "Security", text: "Give response teams a clear picture of every floor and exit." },
    { icon: "plane", title: "Airports", text: "Lead travellers to gates, lounges and services on time." },
    { icon: "building", title: "Campuses and offices", text: "Help staff, students and guests find rooms, labs and meeting spaces." },
    { icon: "wrench", title: "Facility management", text: "Keep rooms, assets and maintenance work organised on one map." },
    { icon: "calendar", title: "Events", text: "Show visitors the way to halls, stands and sessions." },
    { icon: "bed", title: "Hotels & Resorts", text: "Let guests find rooms, restaurants and facilities with ease." },
    { icon: "factory", title: "Industry", text: "Map plants and warehouses so people and goods move safely." },
    { icon: "shirt", title: "Garments", text: "Map production floors, lines and stores across a factory complex." }
  ]
};

// The request form opens the visitor's email app with the request written out
// (to BRAND.email). To collect requests with a form service instead, put its
// address in `endpoint`: the fields are then posted to it.
export const DEMO = {
  eyebrow: "Book a demo",
  cta: "Book a demo",
  title: "See how IndoorWay can guide people through your venue",
  lead: "Whether you run a hospital, a campus, a factory or any other large venue, tell us about your space and we will show you what IndoorWay can do for it.",
  expectTitle: "What to expect",
  expect: [
    "We review your request and pass it to the right person on our team.",
    "We contact you to arrange a short discovery call.",
    "We prepare a demo that shows IndoorWay in your own venue."
  ],
  endpoint: "",
  subject: "IndoorWay demo request",
  fields: {
    email: "Business Email",
    phone: "Phone Number",
    firstName: "First Name",
    lastName: "Last Name",
    company: "Company Name",
    mapping: "What are you mapping?",
    details: "Include a few details about your project."
  },
  other: "Other",
  consent: "Send me news and updates from IndoorWay. I can unsubscribe at any time.",
  submit: "Submit now",
  sentMail: "Your email app should now open with your request ready to send. If it does not, please write to us at",
  sent: "Thank you. We have received your request and will be in touch soon.",
  failed: "Your request could not be sent. Please write to us at"
};

// The footer: the logo and office address, then the lists of solutions,
// industries and showcase maps.
export const FOOTER = {
  tagline: "Indoor Navigation by SrcDrive",
  contact: "Contact"
};

// The menu. Each entry is a page of its own: the first screen shows only the
// hero, and a menu link opens its page (the demo form is a page too).
export const NAV = [
  { label: "Solutions", target: "solutions", menu: SOLUTIONS.items.map((item) => ({ label: item.title, icon: item.icon, target: `solution-${item.id}` })) },
  { label: "Showcase", target: "showcase" },
  { label: "Industries", target: "industries", wide: true, menu: INDUSTRIES.items.map((item) => ({ label: item.title, icon: item.icon, target: "industries" })) }
];
