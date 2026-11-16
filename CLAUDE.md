# The Snuggly Duckling ERP: house rules

This system is demoed live to Dr. Wright (GSCM 401). The team must be able to explain every
screen and every number, so **simple and explainable beats clever and complete.**

## 1. Keep it simple
- Build only what a requirement or the rubric asks for. Anything extra needs Joe's OK first.
- One way to do each job: one screen, one button, one database function. No duplicate paths.
- Use the course's words on screen (gross requirements, ROP, EOQ, lot for lot, WAC), not invented terms.
- If a feature is hard to explain in two sentences, simplify it before adding more.

## 2. Every number explains itself
- Every number is computed from stored data, never typed in.
- Key numbers get a "show the math" view: the formula with the real values filled in.

## 3. One path for data
- Every action (sale, return, receipt, transfer, production) calls one database function.
  That function writes the document, the inventory ledger (`inventory_txns`) and the
  journal (`journal_lines`) together, so stock and money can never disagree.

## 4. Teach while building
After every change, explain it to Joe in plain words, short:
1. **What it does:** one or two sentences.
2. **Where it lives:** page → table(s) → database function.
3. **The concept:** the course idea behind it.
4. **If Wright asks…** one likely question and a good answer.

Then add the same points to `docs/HOW-IT-WORKS.md`, the team's study guide.
