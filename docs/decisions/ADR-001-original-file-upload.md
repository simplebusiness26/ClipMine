# ADR-001: Original-File Upload for MVP

- Status: Accepted
- Date: 2026-08-13

## Context

The product idea began with taking YouTube videos and creating shorts. A public YouTube URL does not provide a general authorised download interface or prove rights to process/reuse the contained media. URL fetching also adds fragility and platform-policy dependency before core clipping quality is proven.

## Decision

The MVP accepts original media files uploaded by a user who confirms sufficient rights. It does not download arbitrary YouTube URLs. A later authorised import may be added only through a platform-supported method and after policy/legal review.

## Consequences

- Faster and more reliable MVP
- Clearer media quality and upload provenance
- Extra step for creators who no longer hold the source file
- Upload recovery and storage become core engineering work
- Product remains useful even if platform import rules change

## Reversal trigger

A stable official platform mechanism, with approved rights and acceptable user experience, becomes available and passes review.

