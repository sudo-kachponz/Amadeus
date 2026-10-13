// Everything on /company lives here so copy can be edited (or translated)
// without touching layout code. Rule for this file: only facts we can back
// up. Anything not yet confirmed stays `draft: true` and is not rendered.

export const COMPANY = {
  name: "Neutrack",
  tagline: "Science fiction is our final fantasy.",
  intro:
    "Neutrack is an Indonesian technology studio. We build AI agents and software for teams, and we teach what we learn along the way through e-books, webinars, and hands-on workshops.",
  links: {
    instagram: "https://www.instagram.com/neutrack.id",
    youtube: "https://www.youtube.com/@NeutrackAIWorld/videos",
    contact: "https://www.instagram.com/neutrack.id", // TODO: ganti ke email / form kontak resmi
  },
  founder: {
    name: "Firania Putri Harsanti",
    handle: "@kachponz",
    note: "Founder of Neutrack. Co-built Neutrack AI Glove with Memory Reboot, built Ling Chinese Lab, and builds Amadeus.", // TODO: sesuaikan dengan bio LinkedIn
    linkedin: "https://www.linkedin.com/in/firania-putri-harsanti-ab77a2237",
    instagram: "https://www.instagram.com/kachponz/",
  },
};

export interface Chapter {
  when: string;
  title: string;
  body: string;
  proof?: string;
}

// The real sequence, oldest first. Numbered on the page because it IS a timeline.
export const STORY: Chapter[] = [
  {
    when: "Semester 3", // TODO: tambahkan tahun
    title: "It started with a question, not a product",
    body:
      "A coursework assignment for Konsep Kecerdasan Artifisial. Firania Putri Harsanti, Pelangi Masita Wati, and Arundaya Pratama Nurhasan formed a team called Memory Reboot and asked something personal: could AI help a childhood friend who is blind, and an aunt living with Alzheimer's?",
  },
  {
    when: "January 2024",
    title: "Cables tied to the back of a hand",
    body:
      "The first Neutrack AI Glove was a distance sensor and a camera strapped onto a glove, every wire exposed. The judges cared about the problem more than the polish.",
    proof: "1st place, GDSC HackFest Indonesia 2024. Covered by Kemdiktisaintek on 27 February 2024.",
  },
  {
    when: "2024",
    title: "From the glove to the cosmos",
    body:
      "The glove went on to Google Solution Challenge 2024 and GEMASTIK XVII in the smart devices category. Nine months after the cable prototype, the same team shipped Neutrack AI Cosmos with a name, an identity, and a demo strangers could follow without us in the room.",
    proof: "Most Innovative Project, national nomination, NASA International Space Apps Challenge 2024 Jakarta.",
  },
  {
    when: "First client",
    title: "Competitions don't pay for servers",
    body:
      "Ling Chinese Lab teaches Mandarin to Indonesian migrant workers and needed to sell e-books without losing them to link sharing. We built a reader with a unique link per buyer, a two-device limit, and dynamic QRIS payments.",
    proof: "100 GB+ delivered. One week of sales covered the IT costs. Rp0 on ads, no VPS, no funding.",
  },
  {
    when: "Ongoing",
    title: "Teaching what we learned",
    body:
      "Every bug we fixed became a lesson. We started running webinars on machine learning, self-supervised learning, and working with AI coding agents, and turned our project stories into e-books.",
  },
  {
    when: "Now",
    title: "Amadeus",
    body:
      "Our flagship: a platform where people, AI agents, and robots work in one loop. Everything before this taught us that useful technology starts from a real constraint, not from the model.",
  },
];

export interface Service {
  title: string;
  body: string;
  examples: string;
}

export const SERVICES: Service[] = [
  {
    title: "AI agents and software",
    body: "Agentic workflows, integrations over MCP and APIs, and the web and mobile apps around them.",
    examples: "Amadeus, Ling Chinese Lab platform",
  },
  {
    title: "E-books and learning products",
    body: "Interactive web-based e-books with per-buyer links, device limits, and built-in workbooks.",
    examples: "My Mind Palace Vol. I",
  },
  {
    title: "Webinars and workshops",
    body: "Sessions for beginners and teams on machine learning, world models, and building with AI agents.",
    examples: "Follow @neutrack.id for the next session",
  },
  {
    title: "Educational hardware",
    body: "Assistive and learning devices that combine sensors, computer vision, and voice.",
    examples: "Neutrack AI Glove",
  },
];

export interface CaseStudy {
  name: string;
  problem: string;
  built: string;
  result: string;
  draft?: boolean;
}

export const WORK: CaseStudy[] = [
  {
    name: "Neutrack AI Glove",
    problem: "People with visual impairment and early dementia need help recognising objects, faces, and paths.",
    built: "A wearable combining computer vision, distance sensing, and voice feedback.",
    result: "1st place, GDSC HackFest Indonesia 2024. Then Google Solution Challenge 2024 and GEMASTIK XVII.",
  },
  {
    name: "Neutrack AI Cosmos",
    // TODO: tulis masalah & solusi persis AI Cosmos (belum terverifikasi)
    problem: "NASA Space Apps asks teams to turn open space data into something people can use.",
    built: "Neutrack AI Cosmos, built during the 2024 challenge.",
    result: "Most Innovative Project, national nomination, Jakarta.",
  },
  {
    name: "Ling Chinese Lab",
    problem: "Selling e-books with no budget, no server, and a real risk of piracy.",
    built: "Flip-page reader, unique buyer links, two-device lock, dynamic QRIS.",
    result: "100 GB+ delivered on Rp0 ad spend; IT costs covered in one week.",
  },
  // Belum dikonfirmasi untuk tampil publik — ubah draft ke false kalau sudah oke.
  {
    name: "Robotku",
    problem: "Students need a friendly way into robotics and code.",
    built: "Block coding and Python editor with ESP32 firmware and a custom maker kit.",
    result: "TODO",
    draft: true,
  },
  {
    name: "Coding Fantasy",
    problem: "Kids find programming abstract.",
    built: "A mobile game teaching NLP, Python, and computer vision through drag and drop.",
    result: "TODO",
    draft: true,
  },
];

export interface Book {
  title: string;
  author: string;
  blurb: string;
  href?: string; // TODO: link halaman jual
}

export const LIBRARY: Book[] = [
  {
    title: "My Mind Palace Vol. I: Engineering Reality",
    author: "Firania Putri Harsanti",
    blurb:
      "Six rooms, one curious rabbit, and real stories from building Ling Chinese Lab and Neutrack AI Glove. A workbook for thinking like a developer.",
  },
];

export interface Webinar {
  title: string;
  date: string;
  poster?: string; // path di /public
  slides?: string;
}

// Diisi dari poster IG. Kosong = section menampilkan ajakan follow.
export const WEBINARS: Webinar[] = [];
