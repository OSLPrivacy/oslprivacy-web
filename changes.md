# changes to oslprivacy website 28/7/26

# PILLARS OF WORK:
- Always follow instructions **carefully**, you may innovate under my approval when you see it viable and my instructions can be improved.

- Follow design rules: colors, spacing, shapes, fonts, etc is key.

- Give your **best** effort when something doesn't work out first try

- Structure a plan, show your plan, act on it and you will do good.

- Give me information on how i can see your progress (example: showing me on what port the website is running so i can inspect the work)

# Repo guide:
- Use **CLAUDE.md** as a guide on where everything is on our repo
- At the end of our conversation, when i say **"write commit"** simply type out a commit of all changes and allow me to copy and paste it. I will give you credit as a co-author
- **Delegate** some tasks to a lower resource model to save tokens and use Opus 4.8 mainly for planning and harder scripting
- **do not** use the chrome extension for web development, as i have found it to be buggy and more token hungry, use an alternative like chrome cli instead.
/
## Task list overview: - IF its crossed out on this list, ignore
- ~~Visual changes: I will go more into detail, i will use the photos inside the changes-photos to indicate what i mean, or sometimes i will refer to html elements for simpler things btw; add changes-photos to .gitinore pls pls pls~~

- Visual changes II: the burn effect

- ~~Social media comparison safety review (with tick and crosses on a table)~~


### Visual changes:

- **sizing-issue.png** shows how when the website window is streched sometimes there's scaling issues and it cuts off parts of the website. its really important that you make this key change so ALL of our elements are adaptable in some way to change in webpage size

- **add-animation.jpg** shows the work you have done previously in the downloads page at the bottom. I want you to animate it and make it more visually understandable just by looking.

- **simplify.jpg** shows the features page. I want you to simplify this design by turning these double squares that are also slightly tilted into flat squares

- **anim-overlap.jpg** shows how theres a part of the animation (a pill) that sicks out of the square containing it. i don't like this overlap, get rid of it please.

- message send buttons: make the message send buttons on ALL pages "<i> ::after </i>"

- remove the square on the chat: setup-attach-icon on the downloads page


### Social media comparison safety review:
An page that can provide an analysis of different popular applications and their features (privacy features and app features), make a score for privacy and for features as well as an overall score and compare to OSL Privacy.

This will be sepparate and the tab to it will be found next to features, on the right of it.

use concept.jpg as an idea on how it will look, of course will keeping the design principles of our website like button roundness and proportions, and colors, etc. when the user clicks on read more, it will reveal a sort of table which can compare the two apps:
```
            OSL | Discord | Telegram |  Whatsapp | Messenger | Signal
feature: |    ✅     ❌        ❌             ❌                ❌          ❌
```

All the info you will need will be found within a excel file on the root directory for app features and scores that i will formulate with the help of another claude agent, no need to worry about research yourself. find a way to make it quite optimized so that we can make sure that the pages load fast (instead of hardcoding each app, make a way to parse the information..)

use [logo.dev](https://www.logo.dev/) API to fetch and save any logos you need in an organised folder.

the popular applications will be from Europe and North America for now, since this is where most of our customers and potential customers are currently located.


### Visual changes II: the burn effect

# Features Page: "Burn" Icon Row + Animation

## Context
This is for the **features page** of the website, explaining OSL's **Burn** feature — the cleanup/data-wiping action. Burn removes copies that OSL (or a cooperating connected service) can reach. It doesn't reach into someone else's device, undo a screenshot, or delete a key someone already has — that limitation doesn't need to show up in this specific UI, just don't imply otherwise.

## The four Burn scopes
Burn has four scopes, from broadest to narrowest. Show them as a row of four simple square icons, side by side, each representing one scope:

1. **Password burn** — the user enters their password, and it wipes *all* of their OSL data.
2. **Account burn** — while logged in, the user clicks a single button and it wipes their whole OSL account.
3. **Scope burn** — same action as account burn, but limited to one specific connected service (e.g. Discord, an email account) instead of everything.
4. **Chatburn** — the individual/per-chat burn action that already exists on the current page — the narrowest scope.

## Layout
- Four rounded-square containers in a row, evenly spaced, identical size.
- One icon per square, in order above (password → account → scope → chat).

## Icon style
Minimal, single-line/outline sketches — not detailed illustrations. Rough starting direction from an early sketch (treat as a suggestion, not final glyphs — feel free to design cleaner versions that fit the site's existing icon language):
- Password burn → something padlock-like
- Account burn → a signature/squiggle mark
- Scope burn → a magnifying glass
- Chatburn → keep it plain/blank, simplest of the four

Keep stroke weight and size consistent across all four so they read as one set.

## Animation
Each icon needs a short animation that visually communicates "this data just got wiped." Two directions worth prototyping — we haven't picked one yet:

- **Text dissolve**: a short sample line of text fades / turns invisible, as if being erased.
- **Icon disintegrate**: the icon itself breaks apart into small particles and disperses, like ash.

Whichever direction, apply the *same* treatment to all four icons so the set feels unified — this is explanatory UI, not a hero animation, so keep it simple and quick.

**Open question to resolve during implementation:** try both directions on one icon first and show a comparison before building out all four, since we're not certain which reads better.
