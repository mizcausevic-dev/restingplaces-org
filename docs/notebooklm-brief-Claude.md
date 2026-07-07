# NotebookLM asset brief: respectful audio walking tours

## What to make

Audio walking tours of historic cemetery clusters, generated in NotebookLM from this repository's structured data. Each tour covers one cemetery or one city cluster and walks the listener through documented facts: founding context, landscape design tradition, heritage status, and the documented notable interments with their dates and what they were known for.

## Source material to feed NotebookLM

- `/api/cemeteries/[slug].json` for each cemetery in the tour: the full fact record and complete interment list.
- The matching guide page text (`/guides/historic-garden-cemeteries/`, etc.) for framing.
- The cemetery's Wikipedia article URL (in the record) as narrative background; NotebookLM may read it, we still never republish its prose on the site.

## Candidate first episodes (from the data, by documented interments)

1. Père Lachaise Cemetery, Paris. The founding garden cemetery, 1804.
2. Highgate Cemetery, London. Victorian garden cemetery tradition.
3. Arlington National Cemetery. National remembrance, protocol-heavy tone.
4. Zentralfriedhof, Vienna. The composers' quarter.
5. La Recoleta, Buenos Aires.

## Voice and dignity rules (non-negotiable)

- Historical and biographical register. No morbid framing, no ghost stories, no clickbait, no dramatized death scenes.
- Facts only from the structured records; where the record is silent, the script says nothing.
- Living relatives are never mentioned. Only the documented public figures in the interment graph appear.
- No AI-generated imagery for artwork or promotion in this vertical. Dignity and authenticity outrank novelty; use cleared Commons photographs or text-only art.
- Attribute Wikidata (CC0) and any Commons imagery in the episode notes.
