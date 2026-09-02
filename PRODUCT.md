# n/acc (Nepal Accelerates) - product facts

## What it is
- A manifesto and a door. n/acc is a movement for building in Nepal instead of leaving it.
- Today it is the manifesto, an anonymous founder who signs as "Zens", and one inbox. Nothing else is claimed.
- Everything else (capital, cohorts, a studio, a community) is deliberately left vague and hinted at, never promised.

## Audience
- Young Nepali founders, engineers, students, and returnees who are deciding whether to stay or leave. They arrive tired, sceptical, often late at night, on a phone.
- Second audience: people with capital or conviction who want a way in. They must feel the door exists without a pitch deck.

## The single job
- Get the reader to write. One message to hello@nepalaccelerates.com, sent through the site's own mail system (mail.nepalaccelerates.com).

## Voice
- First person, direct, unhedged. Speaks to one reader, not a market.
- Specific over grand. A place name, a time of day, a real number with a year beats an adjective.
- No sales vocabulary. No exclamation marks. No emojis. No em dashes. Contractions are fine.
- The founder is anonymous by choice. Sign as Zens. Never invent a bio, a photo, a team, a portfolio, a count, a quote, or a logo.

## Constraints
- Static site on Vercel from github.com/nepalaccelerates/nepalaccelerates (main branch, no build step). Keep it buildless: index.html plus assets and a small JS module.
- Domain nepalaccelerates.com (apex redirects to www). DNS on Cloudflare, DNS only, not proxied.
- Contact form posts to https://mail.nepalaccelerates.com/api/contact (endpoint to be added to the Cloudflare Worker in C:/Users/milan/nepal-mail) which files the message into admin@nepalaccelerates.com's inbox.
- Mobile-first. Inputs never trigger iOS zoom. Works with JavaScript disabled (content and form still usable).
- No fake proof of any kind. No testimonials, no logos, no numbers without a source.

## Evidence available
- The manifesto text itself (to be tightened, voice preserved).
- Verified public facts about Nepal (see .design/facts.md once produced): migration, remittances, geography, connectivity.
- The site's own build: no board, no bureaucracy, messages reach the founder directly. That claim is true and can be stated.
