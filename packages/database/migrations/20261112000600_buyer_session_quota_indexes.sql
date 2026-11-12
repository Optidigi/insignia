-- migrate:up
-- #371: one buyer session now holds up to 100 drafts, 1,000 retained proposals and 250 cart
-- applications. Each write counts its session's rows, and erasing an expired session cascades to
-- them; without these indexes both scan every shop's rows, and one cleanup pass over full sessions
-- outlasts the worker's statement timeout. buyer_commands is already keyed by session first.
CREATE INDEX design_drafts_session ON design_drafts(session_id);
CREATE INDEX quote_proposals_session ON quote_proposals(session_id);
CREATE INDEX cart_applications_session ON cart_applications(session_id);
-- migrate:down
DROP INDEX cart_applications_session, quote_proposals_session, design_drafts_session;
