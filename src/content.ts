/**
 * All text, links and media paths for the site.
 *
 * Edit freely: the page HTML is generated from this file at build time
 * (see vite.config.ts and src/page/render.ts), so no scene code needs touching.
 *
 * Media paths are relative to `public/`, e.g. "/videos/sailing.mp4" is `public/videos/sailing.mp4`.
 * If a video file is missing, the card shows a styled placeholder instead of a broken player.
 *
 * Project `id`s are used in the page anchors and to attach the scene "moments"
 * (src/scene/moments/registry.ts). Keep them stable; text can change freely.
 */

export interface Link {
  label: string;
  href: string;
}

export interface Site {
  name: string;
  /** Where it is live (e.g. its Cloudflare address). */
  href: string;
  /** One line: what it is and what you built. */
  text: string;
  /** The chapter's clip shows this site: its Watch clip button sits here. */
  clip?: boolean;
}

export interface ProjectVideo {
  mp4: string;
  webm: string;
  /** Still frame shown before the clip loads (and when motion is reduced). */
  poster: string;
  /** Describes what the clip shows, for screen readers. */
  description: string;
}

export interface Project {
  id: string;
  title: string;
  /** Short name in the chapter row at the top of the page. */
  chapter: string;
  /** The big brush-lettered word painted on the lake at this stop. */
  word: string;
  /** Short engine tag shown on the card, e.g. "Unreal Engine 5". */
  engine: string;
  /** Year, team size, duration. Joined with " · ". */
  meta: string[];
  design: string;
  code: string;
  links: Link[];
  video: ProjectVideo;
}

const video = (id: string, description: string): ProjectVideo => ({
  mp4: `/videos/${id}.mp4`,
  webm: `/videos/${id}.webm`,
  poster: `/videos/${id}.jpg`,
  description,
});

export const content = {
  /** What search engines and link previews show (title up to ~60 characters, description ~155). */
  site: {
    title: 'Katarzyna Kardyś – Game Developer (Unity, Unreal Engine 5)',
    description:
      'Game developer portfolio of Katarzyna Kardyś: gameplay programming, technical and level design in Unity (C#) and Unreal Engine 5, with clips of each project.',
    url: 'https://dyskna.pl', // the live address: canonical link, sitemap, link previews and IndexNow use it
    lang: 'en',
    locale: 'en_US',
    /** The name as people type it without Polish letters. */
    nameAscii: 'Katarzyna Kardys',
    /** The site's name in search results ("WebSite" structured data); the others are accepted too. */
    siteName: 'Katarzyna Kardyś',
    siteNameAlternates: ['Katarzyna Kardys', 'Katarzyna Kardyś Portfolio', 'Katarzyna Kardys Portfolio'],
    jobTitle: 'Game Developer',
    university: 'Rzeszów University of Technology',
    knowsAbout: [
      'Game development',
      'Gameplay programming',
      'Technical design',
      'Level design',
      'Unity',
      'C#',
      'Unreal Engine 5',
      'Blueprints',
      'Multiplayer networking',
      'Reinforcement learning',
      'Web development',
    ],
    /** Describes og.jpg for screen readers in link previews. */
    imageAlt: 'A sailboat by a wooden pier on a low-poly mountain lake, with the words “I like building good stuff” painted on the water.',
    /**
     * Cloudflare Web Analytics token (dashboard → Analytics & Logs → Web Analytics → the dyskna.pl
     * site → its snippet's "token"). Visits are counted without cookies; empty turns it off.
     */
    analyticsToken: '',
  },

  hero: {
    /** Short name in the chapter row. */
    chapter: 'Pier',
    name: 'Katarzyna Kardyś',
    tagline: 'Game developer. Unity (C#) and Unreal Engine 5.',
    /** The brush word painted on the lake at the pier; the name stays small in the caption. */
    word: 'I like building good stuff',
    cue: 'Scroll to set sail',
  },

  projectsIntro: {
    label: 'Selected work',
    title: 'Projects',
    text: 'Each project has two sides: what the player should feel, and the systems that make it happen.',
  },

  projects: [
    {
      id: 'sailing',
      title: 'Sailing prototype',
      chapter: 'Sailing Prototype',
      word: 'Sailing Prototype',
      engine: 'Unreal Engine 5',
      meta: ['2026', 'Solo', 'Two weeks'],
      design:
        'A calm sailing game about the mood of being on the water. You walk freely on deck while trimming the sail and steering; the lake, built with the Foliage Tool, changes with a dynamic weather system.',
      code:
        "A simplified apparent-wind model (true wind that changes over time plus the wind from the boat's motion) drives the boat and makes the sail flap and fill. This page runs on the same model.",
      links: [{ label: 'Watch on LinkedIn', href: 'https://lnkd.in/p/eDbgFhEK' }],
      video: video('sailing', 'Sailing across a mountain lake, seen from the bow of the boat under its sail.'),
    },
    {
      id: 'chery',
      title: 'Chery the Game',
      chapter: 'CheryTheGame',
      word: 'CheryTheGame',
      engine: 'Unity 2D',
      meta: ['2024 to now', 'Early alpha'],
      design: 'A story-driven 2D game with branching dialog and NPC interactions. The early alpha is playable on itch.io, and I document its development in Instagram reels.',
      code: 'Core gameplay in C#: inventory, NPC interactions and combat, plus a dialog system in Ink with branching paths and global variables.',
      links: [
        { label: 'Play the alpha on itch.io', href: 'https://dyskna.itch.io/chery-the-game-early-alpha' },
        { label: 'Devlog on Instagram', href: 'https://www.instagram.com/dyska.making.games' },
      ],
      video: video('chery', 'Pixel-art screenshot: the red-haired heroine on a forest path among trees and lanterns.'),
    },
    {
      id: 'escape-from-weii',
      title: 'EscapeFromWEII',
      chapter: 'Escape',
      word: 'Escape',
      engine: 'Unreal Engine 5 · VR',
      meta: ['2025', 'University team'],
      design: 'A VR escape room for the Valve Index: three puzzle rooms that recreate real rooms of my faculty building.',
      code: 'Built with a university team in Blueprints: VR interactions and puzzle logic.',
      links: [{ label: 'Source on GitHub', href: 'https://github.com/dyskna/EscapeFromWeii' }],
      video: video('escape-from-weii', 'First-person VR footage: hands pick up objects and solve a puzzle in a university room.'),
    },
    {
      id: 'multiplayer-sumo',
      title: 'Multiplayer Sumo',
      chapter: 'Multiplayer',
      word: 'Multiplayer',
      engine: 'Unity DOTS',
      meta: ['2026', 'Network prototype'],
      design: 'A competitive two-player network game, built on the Data-Oriented Technology Stack for performance.',
      code: 'Client-server architecture with full server authority, client-side prediction, rollback and resimulation.',
      links: [{ label: 'Source on GitHub', href: 'https://github.com/dyskna/MultiplayerBase' }],
      video: video('multiplayer-sumo', 'Two cubes push each other around a square arena while a counter tracks how often each player falls.'),
    },
    {
      id: 'thesis',
      title: 'BSc thesis',
      chapter: 'PPO agent',
      word: 'PPO agent',
      engine: 'Unity · ML-Agents',
      meta: ['2026'],
      design: 'A custom Unity environment for an AI agent: I designed the learning environment, its observations and the reward system used to evaluate the model.',
      code: 'The agent is trained with reinforcement learning, Proximal Policy Optimization (PPO), using ml-agents.',
      links: [{ label: 'Source on GitHub', href: 'https://github.com/dyskna/Chery-The-Game-PPO' }],
      video: video('thesis', 'Numbered AI agents moving through a pixel-art level while they train, in the Unity editor.'),
    },
  ] satisfies Project[],

  /**
   * Websites from the fullstack internship: one stop on the lake after the projects (`id` must
   * stay 'web'). Its screen on the lake shows public/videos/web.mp4 or .webm (a short screen
   * recording) or, without one, public/videos/web.jpg (a screenshot).
   * Add more sites to `sites` as they go live (name, address, one line each).
   */
  web: {
    id: 'web',
    chapter: 'Web',
    word: 'Web',
    label: 'Full-stack intern · Wellysa',
    meta: ['Jan to Apr 2026', 'Remote'],
    title: 'Web development',
    intro:
      'At Wellysa I implemented UI and application logic and deployed services on Cloudflare Workers and Pages, working full cycle from mockup to deployment, with Git and code review in a remote team.',
    stack: 'TypeScript · React · HTML/CSS · Cloudflare Workers & Pages',
    sites: [
      {
        name: 'LiftMe · HackYeah 2026',
        href: 'https://github.com/dyskna/HackYeah2026',
        text: 'A real-time elevator-calling web app, built in a team of four; I planned the implementation and deployed it.',
        clip: true,
      },
    ] satisfies Site[],
    video: video('web', 'LiftMe on a phone: choosing the floor and group size, calling the lift, and the countdown as the lift comes up.'),
  },

  about: {
    chapter: 'About',
    word: 'About',
    label: 'Background',
    title: 'About',
    paragraphs: [
      'Computer Science at Rzeszów University of Technology (BSc 2026, MSc until 2027). I work where design meets technology: gameplay programming, technical design and level design.',
      'I build games in Unity (C#) and Unreal Engine 5 (Blueprints), draw pixel art in Aseprite and model in Blender. I have also worked with AI and data, on CorrectWorkout: a university research app that checks exercise form from video (patent application filed).',
    ],
    pageNote: {
      title: 'About this page',
      text: "The lake behind this page runs on the apparent-wind model from my sailing prototype. A true wind drifts slowly over time; your scrolling moves the boat and adds the wind from its motion. The sail follows the sum of the two. Switch on Debug view to see the vectors.",
    },
  },

  contact: {
    chapter: 'Harbour',
    word: 'Harbour',
    label: 'Open to work',
    title: 'Want to be my crewmate?',
    text: 'I am looking for my first role in a game studio, in gameplay programming, technical design or level design.',
    /** Closing line after the text; its last word links to the contact link with that label. */
    invite: { text: 'If you are interested, feel free to reach out on', link: 'LinkedIn' },
    /** The first link is the one to reach me by: the list sets it larger. */
    links: [
      { label: 'LinkedIn', href: 'https://www.linkedin.com/in/katarzyna-kardyś-908a963a2' },
      { label: 'itch.io', href: 'https://dyskna.itch.io/chery-the-game-early-alpha' },
      { label: 'GitHub', href: 'https://github.com/dyskna' },
      { label: 'Instagram', href: 'https://www.instagram.com/dyska.making.games' },
    ] satisfies Link[],
  },

  /** Shown in the scene at the harbour. */
  harbourLine: 'Want to be my crewmate?',

  footer: '© 2026 Katarzyna Kardyś. Built with Three.js; the lake is procedural.',

  debug: {
    label: 'Debug view',
  },

  /** Small interface words. */
  ui: {
    chapters: 'Chapters',
    listView: 'List view',
    rotate: 'Turn your phone upright',
    portfolio: 'Portfolio',
    entryNo: 'No.',
    clipPlaceholder: 'Clip in production',
    sites: 'Sites',
    internship: 'Internship',
    watchClip: 'Watch clip',
    close: 'Close',
  },
};

export type Content = typeof content;
