/**
 * Quote of the day for the Dashboard: success, optimism, persistence,
 * determination. Only quotes whose attribution is well documented — the
 * famous misattributions ("Churchill", "Einstein", "Twain"…) are left out.
 */
export interface Quote {
  text: string;
  author: string;
}

export const QUOTES: Quote[] = [
  { text: "The best way out is always through.", author: "Robert Frost" },
  { text: "Our greatest glory is not in never falling, but in rising every time we fall.", author: "Oliver Goldsmith" },
  { text: "Genius is one percent inspiration and ninety-nine percent perspiration.", author: "Thomas Edison" },
  { text: "Well done is better than well said.", author: "Benjamin Franklin" },
  { text: "Diligence is the mother of good luck.", author: "Benjamin Franklin" },
  { text: "Little strokes fell great oaks.", author: "Benjamin Franklin" },
  { text: "He that can have patience can have what he will.", author: "Benjamin Franklin" },
  { text: "Lost time is never found again.", author: "Benjamin Franklin" },
  { text: "Do what you can, with what you have, where you are.", author: "Theodore Roosevelt" },
  { text: "Far and away the best prize that life offers is the chance to work hard at work worth doing.", author: "Theodore Roosevelt" },
  { text: "Nothing in the world is worth having or worth doing unless it means effort, pain, difficulty.", author: "Theodore Roosevelt" },
  { text: "Nothing great was ever achieved without enthusiasm.", author: "Ralph Waldo Emerson" },
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "Stay hungry. Stay foolish.", author: "Steve Jobs" },
  { text: "Ever tried. Ever failed. No matter. Try again. Fail again. Fail better.", author: "Samuel Beckett" },
  { text: "Never give in — never, never, never, never, in nothing, great or small, large or petty.", author: "Winston Churchill" },
  { text: "You miss 100% of the shots you don't take.", author: "Wayne Gretzky" },
  { text: "Fall seven times, stand up eight.", author: "Japanese proverb" },
  { text: "A journey of a thousand miles begins with a single step.", author: "Lao Tzu" },
  { text: "The impediment to action advances action. What stands in the way becomes the way.", author: "Marcus Aurelius" },
  { text: "Waste no more time arguing what a good man should be. Be one.", author: "Marcus Aurelius" },
  { text: "We suffer more often in imagination than in reality.", author: "Seneca" },
  { text: "Luck is the residue of design.", author: "Branch Rickey" },
  { text: "Plans are worthless, but planning is everything.", author: "Dwight D. Eisenhower" },
  { text: "Optimism is the faith that leads to achievement.", author: "Helen Keller" },
  { text: "Hard work beats talent when talent doesn't work hard.", author: "Tim Notke" },
  { text: "The best time to plant a tree was twenty years ago. The second best time is now.", author: "Chinese proverb" },
  { text: "Be so good they can't ignore you.", author: "Steve Martin" },
  { text: "Pressure is a privilege.", author: "Billie Jean King" },
  { text: "Champions keep playing until they get it right.", author: "Billie Jean King" },
  { text: "Great works are performed not by strength but by perseverance.", author: "Samuel Johnson" },
  { text: "Nothing will ever be attempted if all possible objections must first be overcome.", author: "Samuel Johnson" },
  { text: "Always bear in mind that your own resolution to succeed is more important than any other one thing.", author: "Abraham Lincoln" },
  { text: "You must do the thing you think you cannot do.", author: "Eleanor Roosevelt" },
  { text: "Chance favors only the prepared mind.", author: "Louis Pasteur" },
  { text: "Believe that life is worth living and your belief will help create the fact.", author: "William James" },
  { text: "Perfection is not attainable, but if we chase perfection we can catch excellence.", author: "Vince Lombardi" },
  { text: "It's not whether you get knocked down; it's whether you get up.", author: "Vince Lombardi" },
  { text: "We are what we repeatedly do. Excellence, then, is not an act, but a habit.", author: "Will Durant" },
  { text: "The secret of success is constancy to purpose.", author: "Benjamin Disraeli" },
  { text: "Success is the sum of small efforts, repeated day in and day out.", author: "Robert Collier" },
  { text: "Our doubts are traitors, and make us lose the good we oft might win, by fearing to attempt.", author: "William Shakespeare" },
  { text: "There is a tide in the affairs of men which, taken at the flood, leads on to fortune.", author: "William Shakespeare" },
  { text: "Be not afraid of growing slowly; be afraid only of standing still.", author: "Chinese proverb" },
  { text: "If you want to go fast, go alone. If you want to go far, go together.", author: "African proverb" },
  { text: "Success is how high you bounce when you hit bottom.", author: "George S. Patton" },
  { text: "Courage is grace under pressure.", author: "Ernest Hemingway" },
  { text: "Knowing is not enough; we must apply. Willing is not enough; we must do.", author: "Johann Wolfgang von Goethe" },
  { text: "Well begun is half done.", author: "Aristotle" },
  { text: "A ship in harbor is safe, but that is not what ships are built for.", author: "John A. Shedd" },
  { text: "Make each day your masterpiece.", author: "John Wooden" },
  { text: "Don't let what you cannot do interfere with what you can do.", author: "John Wooden" },
  { text: "Hope is a good breakfast, but it is a bad supper.", author: "Francis Bacon" },
  { text: "Fortune favors the bold.", author: "Virgil" },
  { text: "If I have seen further, it is by standing on the shoulders of giants.", author: "Isaac Newton" },
];

/** Deterministic shuffle (mulberry32), so the order looks random but is the same every run. */
function shuffled<T>(xs: T[], seed: number): T[] {
  const out = [...xs];
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const ORDER = shuffled(QUOTES, 20261012);

/**
 * Today's quote: a new one each local calendar day, walking a fixed shuffled
 * order so no quote repeats until all of them have been shown.
 */
export function quoteOfTheDay(date: string): Quote {
  const day = Math.floor(new Date(`${date}T12:00:00Z`).getTime() / 86_400_000);
  return ORDER[((day % ORDER.length) + ORDER.length) % ORDER.length];
}
