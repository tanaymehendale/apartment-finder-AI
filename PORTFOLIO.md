# ApartmentFinder AI

A hierarchical multi-agent system that turns apartment hunting from five browser tabs into one conversation — deployed live at [apartment-finder-ai.vercel.app](https://apartment-finder-ai.vercel.app).

## Problem Statement

Relocating to a new city means manually stitching together three separate workflows: searching listing sites for budget/layout, copying every address into Google Maps to check commute times, and searching Reddit/Google to vet neighborhood safety — then compiling it all into a spreadsheet by hand. It's slow, repetitive, and easy to get wrong (e.g., checking the wrong commute distance because of a mis-geocoded landmark).

## Approach

Built a **hierarchical multi-agent architecture** on Google's Agent Development Kit (ADK) with Gemini 2.5 Flash, rather than one monolithic prompt. A **Manager** agent handles the conversation and requirement-gathering (city, state, budget, landmark, plus optional bedrooms/bathrooms/roommates), then delegates to a **Research Team** — a sequential pipeline of specialist sub-agents (Analyst → Reviewer → Summarizer) that each own one concern: fetching and filtering listings, checking real commute times, researching neighborhood safety, and synthesizing a final recommendation. Splitting responsibilities this way keeps each agent's prompt focused and makes the pipeline's state transitions (e.g., "no results found") deterministic instead of relying on the LLM to self-report status in free text.

## Methodology

- **Tool-grounded agents, not hallucinated data**: listings come from live provider APIs (RentCast, Apify/Zillow) with automatic failover; commute times come from the Google Maps Distance Matrix API using resolved lat/lng (not raw address strings, which was a real bug caught in production); landmark resolution uses Places API (New) text search scoped to the target city.
- **Deterministic control flow around a probabilistic core**: a `before_agent_callback` gate routes on a structured `search_status` signal rather than trusting the model to phrase "no results" correctly in prose — closing a class of routing bugs found during testing.
- **Follow-up-aware state**: users can revise one requirement mid-conversation ("actually make it $3,000") and only the changed field is re-resolved; everything else carries forward from session state instead of forcing a full re-ask.
- **Full observability**: every agent hop, tool call, and LLM generation is traced end-to-end in Langfuse via OpenTelemetry instrumentation, making multi-agent runs debuggable instead of a black box.
- **Production hardening**: containerized on Cloud Run with Firestore-backed usage counters (survives cold starts, unlike file-based counters), CORS-safe direct-to-backend SSE streaming to route around Vercel's serverless timeout, and graceful session recovery when a scaled-to-zero backend loses in-memory state.

## Result

A live, working product: a user states their budget, city, and a landmark (e.g., their office), and within one conversation receives ranked, in-budget apartment recommendations with real commute times and neighborhood safety context — fully deployed (Next.js frontend on Vercel, FastAPI/ADK backend on Cloud Run) and instrumented for observability rather than left as a local prototype.
