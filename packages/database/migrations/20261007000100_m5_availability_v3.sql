-- migrate:up
-- Additive v3 branches. Preserve the exact original v1/v2 predicates and all stored JSONB.
-- V3 predicates never interpret a historical v1/v2 payload.
CREATE FUNCTION m5_v3_json(candidate jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE result text; BEGIN
 CASE jsonb_typeof(candidate)
 WHEN 'object' THEN SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||m5_v3_json(value),',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(candidate);
 WHEN 'array' THEN SELECT '['||coalesce(string_agg(m5_v3_json(value),',' ORDER BY ordinality),'')||']' INTO result FROM jsonb_array_elements(candidate) WITH ORDINALITY;
 ELSE result:=candidate::text; END CASE;
 RETURN result;
END $$;
CREATE FUNCTION m5_v3_digest(candidate jsonb) RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$ SELECT encode(sha256(convert_to(m5_v3_json(candidate),'UTF8')),'hex') $$;
CREATE FUNCTION m5_v3_ids(candidate jsonb, ceiling integer) RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE item jsonb; previous text:=NULL; current_id text; BEGIN
 IF jsonb_typeof(candidate) IS DISTINCT FROM 'array' OR jsonb_array_length(candidate)>ceiling THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(candidate) LOOP
  current_id:=item#>>'{}';
  IF jsonb_typeof(item) IS DISTINCT FROM 'string' OR NOT current_id ~ '^gid://shopify/Publication/[1-9][0-9]{0,30}$' OR (previous IS NOT NULL AND previous COLLATE "C">=current_id COLLATE "C") THEN RETURN false; END IF;
  previous:=current_id;
 END LOOP; RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
CREATE FUNCTION m5_v3_keys(candidate jsonb, required text[], optional text[] DEFAULT ARRAY[]::text[]) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE WHEN jsonb_typeof(candidate)='object' THEN coalesce(candidate ?& required AND NOT EXISTS(SELECT FROM jsonb_object_keys(candidate) AS k WHERE NOT k=ANY(required||optional)),false) ELSE false END
$$;
CREATE FUNCTION m5_v3_facts(candidate jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE item jsonb; previous text:=NULL; published jsonb:='[]'; BEGIN
 IF NOT coalesce(jsonb_typeof(candidate)='object'
  AND m5_v3_keys(candidate,ARRAY['version','scope','productId','state','providerUpdatedAt','effectiveVisibility','observedAt','receivedAt'],CASE WHEN candidate->>'version'='m5-product-availability-snapshot-v3' THEN ARRAY['visibleScheduledOrStaged','effectiveAnchors','effectiveDigest','anchorDigest'] ELSE ARRAY[]::text[] END)
  AND m5_v3_keys(candidate->'scope',ARRAY['shopId','installationGeneration','shopifyShopId','appClientId'])
  AND m5_v3_keys(candidate->'effectiveVisibility',ARRAY['publishedPublicationIds','onlineStore','publicationEvidence','publishedAt','onlineStoreUrl'])
  AND m5_v3_keys(candidate#>'{effectiveVisibility,onlineStore}',ARRAY['publishedAtPresent','urlPresent'])
  AND (candidate#>>'{scope,shopId}') ~ '^[A-Za-z0-9_-]{1,128}$'
  AND (candidate#>>'{scope,installationGeneration}') ~ '^[1-9][0-9]{0,19}$'
  AND (candidate#>>'{scope,shopifyShopId}') ~ '^gid://shopify/Shop/[1-9][0-9]{0,30}$'
  AND (candidate#>>'{scope,appClientId}') ~ '^[a-f0-9]{32}$'
  AND (candidate->>'productId') ~ '^gid://shopify/Product/[1-9][0-9]{0,30}$'
  AND candidate->>'state' IN ('available','unavailable','archived','unlisted')
  AND (candidate->>'providerUpdatedAt') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
  AND (candidate->>'observedAt') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
  AND (candidate->>'receivedAt') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
  AND (candidate->>'receivedAt')::timestamptz>=(candidate->>'observedAt')::timestamptz
  AND (candidate->>'providerUpdatedAt')::timestamptz<=(candidate->>'receivedAt')::timestamptz
  AND m5_v3_ids(candidate#>'{effectiveVisibility,publishedPublicationIds}',64)
  AND jsonb_typeof(candidate#>'{effectiveVisibility,onlineStore,publishedAtPresent}')='boolean'
  AND jsonb_typeof(candidate#>'{effectiveVisibility,onlineStore,urlPresent}')='boolean'
  AND (candidate#>'{effectiveVisibility,onlineStore,publishedAtPresent}')=to_jsonb(candidate#>'{effectiveVisibility,publishedAt}'<>'null'::jsonb)
  AND (candidate#>'{effectiveVisibility,onlineStore,urlPresent}')=to_jsonb(candidate#>'{effectiveVisibility,onlineStoreUrl}'<>'null'::jsonb)
  AND (candidate#>'{effectiveVisibility,publishedAt}'='null'::jsonb OR (candidate#>>'{effectiveVisibility,publishedAt}') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$')
  AND (candidate#>'{effectiveVisibility,onlineStoreUrl}'='null'::jsonb OR (jsonb_typeof(candidate#>'{effectiveVisibility,onlineStoreUrl}')='string' AND length(candidate#>>'{effectiveVisibility,onlineStoreUrl}')<=2048 AND (candidate#>>'{effectiveVisibility,onlineStoreUrl}') ~ '^https://[^@?#[:space:]]+$'))
  AND jsonb_typeof(candidate#>'{effectiveVisibility,publicationEvidence}')='array',false) THEN RETURN false; END IF;
 IF jsonb_array_length(candidate#>'{effectiveVisibility,publicationEvidence}')>250 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(candidate#>'{effectiveVisibility,publicationEvidence}') LOOP
  IF NOT coalesce(m5_v3_keys(item,ARRAY['publicationId','isPublished','publishDate']) AND (item->>'publicationId') ~ '^gid://shopify/Publication/[1-9][0-9]{0,30}$' AND jsonb_typeof(item->'isPublished')='boolean' AND (item->>'publishDate') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$',false) OR (previous IS NOT NULL AND previous COLLATE "C">=(item->>'publicationId') COLLATE "C") THEN RETURN false; END IF;
  PERFORM (item->>'publishDate')::timestamptz;
  previous:=item->>'publicationId';
  IF item->'isPublished'='true'::jsonb THEN published:=published||jsonb_build_array(item->>'publicationId'); END IF;
 END LOOP;
 RETURN published=candidate#>'{effectiveVisibility,publishedPublicationIds}';
EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
CREATE FUNCTION m5_v3_snapshot(candidate jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE item jsonb; ids jsonb:='[]'; schedules jsonb:='[]'; BEGIN
 IF NOT coalesce(candidate->>'version'='m5-product-availability-snapshot-v3' AND NOT candidate ? 'configuredIntent' AND m5_v3_facts(candidate) AND jsonb_typeof(candidate->'effectiveAnchors')='array' AND jsonb_typeof(candidate->'visibleScheduledOrStaged')='array',false) THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(candidate->'effectiveAnchors') LOOP
  IF NOT coalesce(m5_v3_keys(item,ARRAY['publicationId','resolved','productIncluded','autoPublish','supportsFuturePublishing']) AND item->'resolved'='true'::jsonb AND item->'productIncluded'='true'::jsonb AND jsonb_typeof(item->'autoPublish')='boolean' AND jsonb_typeof(item->'supportsFuturePublishing')='boolean',false) THEN RETURN false; END IF;
  ids:=ids||jsonb_build_array(item->>'publicationId');
 END LOOP;
 IF NOT m5_v3_ids(ids,64) OR NOT ids @> (candidate#>'{effectiveVisibility,publishedPublicationIds}') THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(candidate#>'{effectiveVisibility,publicationEvidence}') LOOP
  IF item->'isPublished'='false'::jsonb OR (item->>'publishDate')::timestamptz>(candidate->>'observedAt')::timestamptz THEN schedules:=schedules||jsonb_build_array(item); END IF;
 END LOOP;
 RETURN coalesce(schedules=candidate->'visibleScheduledOrStaged'
  AND candidate->>'anchorDigest'=m5_v3_digest(candidate->'effectiveAnchors')
  AND candidate->>'effectiveDigest'=m5_v3_digest(jsonb_build_object('publishedPublicationIds',candidate#>'{effectiveVisibility,publishedPublicationIds}','onlineStore',candidate#>'{effectiveVisibility,onlineStore}')),false);
EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
CREATE FUNCTION m5_v3_same(candidate jsonb, original jsonb, current_scope jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT coalesce(m5_v3_snapshot(candidate) AND m5_v3_snapshot(original)
  AND candidate->'scope'=current_scope AND candidate->>'productId'=original->>'productId'
  AND candidate->>'state'=original->>'state' AND candidate->>'effectiveDigest'=original->>'effectiveDigest'
  AND candidate->'effectiveAnchors'=original->'effectiveAnchors' AND candidate->>'anchorDigest'=original->>'anchorDigest'
  AND candidate->'visibleScheduledOrStaged'='[]'::jsonb AND original->'visibleScheduledOrStaged'='[]'::jsonb,false)
$$;
CREATE FUNCTION m5_v3_held(candidate jsonb, original jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT coalesce(m5_v3_snapshot(candidate) AND m5_v3_snapshot(original)
  AND candidate->'scope'=original->'scope' AND candidate->>'productId'=original->>'productId'
  AND candidate->>'state'='unavailable' AND candidate#>'{effectiveVisibility,publishedPublicationIds}'='[]'::jsonb
  AND candidate#>'{effectiveVisibility,onlineStore}'='{"publishedAtPresent":false,"urlPresent":false}'::jsonb
  AND candidate->'visibleScheduledOrStaged'='[]'::jsonb AND candidate->'effectiveAnchors'=original->'effectiveAnchors' AND candidate->>'anchorDigest'=original->>'anchorDigest',false)
$$;
CREATE FUNCTION m5_v3_ack(candidate jsonb, original jsonb, state text) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT coalesce(candidate->>'version'='m5-availability-mutation-ack-v3' AND m5_v3_facts(candidate)
  AND candidate->'scope'=original->'scope' AND candidate->>'productId'=original->>'productId' AND candidate->>'state'=state,false)
$$;
CREATE FUNCTION m5_v3_ack_qualified(candidate jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT coalesce(m5_v3_facts(candidate) AND NOT EXISTS(SELECT FROM jsonb_array_elements(candidate#>'{effectiveVisibility,publicationEvidence}') p WHERE p->'isPublished'='false'::jsonb OR p->>'publishDate'>candidate->>'observedAt'),false)
$$;
CREATE FUNCTION m5_v3_mismatch(candidate jsonb, original jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE result jsonb:='[]'; BEGIN
 IF candidate#>'{effectiveVisibility,publishedPublicationIds}' IS DISTINCT FROM original#>'{effectiveVisibility,publishedPublicationIds}' THEN result:=result||jsonb_build_array('effective_publication_ids'); END IF;
 IF candidate#>'{effectiveVisibility,onlineStore}' IS DISTINCT FROM original#>'{effectiveVisibility,onlineStore}' THEN result:=result||jsonb_build_array('online_store_presence'); END IF;
 IF candidate->>'anchorDigest' IS DISTINCT FROM original->>'anchorDigest' THEN result:=result||jsonb_build_array('effective_anchors'); END IF;
 IF candidate->'visibleScheduledOrStaged'<>'[]'::jsonb THEN result:=result||jsonb_build_array('visible_scheduled_or_staged'); END IF;
 RETURN result;
END $$;
CREATE FUNCTION m5_v3_hold(candidate jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE original jsonb:=candidate->'before'; receipt jsonb:=candidate->'restorationReceipt'; compensation jsonb:=receipt->'compensation'; claim jsonb:=candidate->'restorationClaim'; BEGIN
 IF NOT coalesce(m5_v3_keys(candidate,ARRAY['version','operationId','before','held'],ARRAY['acquisitionAcknowledgement','restorationClaim','restorationReceipt']) AND candidate->>'version'='m5-availability-hold-v3' AND (candidate->>'operationId') ~ '^[A-Za-z0-9_-]{1,128}$' AND m5_v3_snapshot(original) AND (candidate->'held'='null'::jsonb OR m5_v3_held(candidate->'held',original)),false) THEN RETURN false; END IF;
 IF candidate->'held'<>'null'::jsonb AND original->>'state'<>'unavailable' AND NOT coalesce(candidate ? 'acquisitionAcknowledgement' AND m5_v3_ack_qualified(candidate->'acquisitionAcknowledgement'),false) THEN RETURN false; END IF;
 IF candidate ? 'acquisitionAcknowledgement' AND NOT m5_v3_ack(candidate->'acquisitionAcknowledgement',original,'unavailable') THEN RETURN false; END IF;
 IF candidate ? 'restorationClaim' AND NOT coalesce(m5_v3_keys(claim,ARRAY['version','operationId','scope','productId','restoreReserved','compensationReserved']) AND claim->>'version'='m5-availability-restoration-claim-v3' AND claim->>'operationId'=candidate->>'operationId' AND claim->'scope'=original->'scope' AND claim->>'productId'=original->>'productId' AND claim->'restoreReserved'='true'::jsonb AND claim->'compensationReserved'='true'::jsonb,false) THEN RETURN false; END IF;
 IF candidate ? 'restorationReceipt' THEN
  IF NOT coalesce(m5_v3_keys(receipt,ARRAY['version','kind','acknowledgement','current'],ARRAY['compensation']) AND candidate ? 'restorationClaim' AND receipt->>'version'='m5-availability-restoration-receipt-v3' AND receipt->>'kind' IN ('RESTORED','NOT_DISPATCHED','RESTORATION_PENDING','CONFLICT','REHELD_CONFLICT') AND (receipt->'acknowledgement'='null'::jsonb OR m5_v3_ack(receipt->'acknowledgement',original,original->>'state')) AND (receipt->'current'='null'::jsonb OR (m5_v3_snapshot(receipt->'current') AND receipt#>'{current,scope}'=original->'scope' AND receipt#>>'{current,productId}'=original->>'productId')),false) THEN RETURN false; END IF;
  IF receipt->>'kind'='RESTORED' AND NOT coalesce(m5_v3_same(receipt->'current',original,original->'scope') AND (original->>'state'='unavailable' OR (m5_v3_ack(receipt->'acknowledgement',original,original->>'state') AND m5_v3_ack_qualified(receipt->'acknowledgement'))),false) THEN RETURN false; END IF;
  IF receipt ? 'compensation' THEN
   IF NOT coalesce(m5_v3_keys(compensation,ARRAY['version','restoreAcknowledgement','restored','mismatch','acknowledgement','current']) AND compensation->>'version'='m5-availability-compensation-receipt-v3' AND compensation->'restoreAcknowledgement'=receipt->'acknowledgement' AND m5_v3_ack(compensation->'restoreAcknowledgement',original,original->>'state') AND m5_v3_snapshot(compensation->'restored') AND compensation#>'{restored,scope}'=original->'scope' AND compensation#>>'{restored,productId}'=original->>'productId' AND compensation#>>'{restored,state}'=original->>'state' AND compensation#>>'{restored,state}' IN ('available','unlisted') AND jsonb_typeof(compensation->'mismatch')='array' AND jsonb_array_length(compensation->'mismatch') BETWEEN 1 AND 4 AND compensation->'mismatch'=m5_v3_mismatch(compensation->'restored',original) AND (compensation->'acknowledgement'='null'::jsonb OR m5_v3_ack(compensation->'acknowledgement',original,'unavailable')) AND compensation->'current'=receipt->'current',false) THEN RETURN false; END IF;
   IF receipt->>'kind'='REHELD_CONFLICT' AND NOT coalesce(m5_v3_ack(compensation->'acknowledgement',original,'unavailable') AND m5_v3_ack_qualified(compensation->'acknowledgement') AND m5_v3_held(compensation->'current',original),false) THEN RETURN false; END IF;
  ELSIF receipt->>'kind'='REHELD_CONFLICT' THEN RETURN false;
  END IF;
 END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
ALTER TABLE m5_activation_evidence DROP CONSTRAINT m5_014_evidence_version;
ALTER TABLE m5_activation_evidence ADD CONSTRAINT m5_014_evidence_version CHECK (((jsonb_typeof(evidence) = 'object'
    AND (evidence->>'version') IS NOT DISTINCT FROM 'm5-activation-evidence-v1') OR COALESCE((jsonb_typeof(evidence) = 'object'
    AND (evidence->>'version') IS NOT DISTINCT FROM 'm5-activation-evidence-v2'),false)) OR COALESCE((jsonb_typeof(evidence)='object' AND evidence->>'version'='m5-activation-evidence-v3'),false));
ALTER TABLE m5_activation_evidence DROP CONSTRAINT m5_014_evidence_identity;
ALTER TABLE m5_activation_evidence ADD CONSTRAINT m5_014_evidence_identity CHECK ((((evidence->>'version') IS NOT DISTINCT FROM 'm5-activation-evidence-v1' AND (evidence->>'shopId') IS NOT DISTINCT FROM shop_id
    AND (evidence->>'configId') IS NOT DISTINCT FROM config_id
    AND (evidence->>'operationId') IS NOT DISTINCT FROM operation_id
    AND (evidence->>'revisionId') IS NOT DISTINCT FROM revision_id
    AND (evidence->>'installationGeneration') IS NOT DISTINCT FROM installation_generation::text
    AND (evidence->>'operationSequence') IS NOT DISTINCT FROM operation_sequence::text
    AND (evidence->>'authorizationGeneration') IS NOT DISTINCT FROM authorization_generation::text
    AND (evidence->'authorizationEpoch') IS NOT DISTINCT FROM to_jsonb(authorization_epoch)
    AND (evidence->'selectedKeyId') IS NOT DISTINCT FROM to_jsonb(selected_key_id)
    AND (evidence->'decisionVersion') IS NOT DISTINCT FROM '1'::jsonb) OR COALESCE(((evidence->>'version') IS NOT DISTINCT FROM 'm5-activation-evidence-v2' AND ((evidence->>'shopId') IS NOT DISTINCT FROM shop_id
    AND (evidence->>'configId') IS NOT DISTINCT FROM config_id
    AND (evidence->>'operationId') IS NOT DISTINCT FROM operation_id
    AND (evidence->>'revisionId') IS NOT DISTINCT FROM revision_id
    AND (evidence->>'installationGeneration') IS NOT DISTINCT FROM installation_generation::text
    AND (evidence->>'operationSequence') IS NOT DISTINCT FROM operation_sequence::text
    AND (evidence->>'authorizationGeneration') IS NOT DISTINCT FROM authorization_generation::text
    AND (evidence->'authorizationEpoch') IS NOT DISTINCT FROM to_jsonb(authorization_epoch)
    AND (evidence->'selectedKeyId') IS NOT DISTINCT FROM to_jsonb(selected_key_id)
    AND (evidence->'decisionVersion') IS NOT DISTINCT FROM '2'::jsonb)),false)) OR COALESCE((evidence->>'version'='m5-activation-evidence-v3'
 AND evidence->>'shopId'=shop_id AND evidence->>'configId'=config_id AND evidence->>'operationId'=operation_id
 AND evidence->>'revisionId'=revision_id AND evidence->>'installationGeneration'=installation_generation::text
 AND evidence->>'operationSequence'=operation_sequence::text AND evidence->>'authorizationGeneration'=authorization_generation::text
 AND evidence->'authorizationEpoch'=to_jsonb(authorization_epoch) AND evidence->'selectedKeyId'=to_jsonb(selected_key_id)
 AND evidence->'decisionVersion'='3'::jsonb),false));
ALTER TABLE m5_activation_state DROP CONSTRAINT m5_014_hold_version;
ALTER TABLE m5_activation_state ADD CONSTRAINT m5_014_hold_version CHECK (((hold IS NULL OR ((hold->>'version') IS NOT DISTINCT FROM 'm5-availability-hold-v1'
    AND (hold->>'operationId') IS NOT DISTINCT FROM operation_id
    AND jsonb_typeof(hold->'before') IS NOT DISTINCT FROM 'object'
    AND (hold#>>'{before,scope,shopId}') IS NOT DISTINCT FROM shop_id)) OR COALESCE((hold IS NULL OR (((hold->>'version') IS NOT DISTINCT FROM 'm5-availability-hold-v2'
    AND (hold->>'operationId') IS NOT DISTINCT FROM operation_id
    AND jsonb_typeof(hold->'before') IS NOT DISTINCT FROM 'object'
    AND (hold#>>'{before,scope,shopId}') IS NOT DISTINCT FROM shop_id)
    AND (hold#>>'{before,version}') IS NOT DISTINCT FROM 'm5-product-availability-snapshot-v2'
    AND COALESCE((hold#>>'{before,intentDigest}') ~ '^[a-f0-9]{64}$',false)
    AND COALESCE((hold#>>'{before,effectiveDigest}') ~ '^[a-f0-9]{64}$',false)
    AND jsonb_typeof(hold#>'{before,configuredIntent,includedPublicationIds}') IS NOT DISTINCT FROM 'array'
    AND jsonb_typeof(hold#>'{before,configuredIntent,publicationSettings}') IS NOT DISTINCT FROM 'array'
    AND jsonb_typeof(hold#>'{before,configuredIntent,scheduled}') IS NOT DISTINCT FROM 'array'
    AND jsonb_typeof(hold#>'{before,effectiveVisibility,publishedPublicationIds}') IS NOT DISTINCT FROM 'array'
    AND (hold->'held'='null'::jsonb OR (jsonb_typeof(hold->'held')='object'
      AND (hold#>>'{held,version}') IS NOT DISTINCT FROM 'm5-product-availability-snapshot-v2'
      AND (hold#>'{held,scope}') IS NOT DISTINCT FROM (hold#>'{before,scope}')
      AND (hold#>>'{held,productId}') IS NOT DISTINCT FROM (hold#>>'{before,productId}')
      AND (hold#>>'{held,state}') IS NOT DISTINCT FROM 'unavailable'
      AND (hold#>'{held,configuredIntent}') IS NOT DISTINCT FROM (hold#>'{before,configuredIntent}')
      AND (hold#>>'{held,intentDigest}') IS NOT DISTINCT FROM (hold#>>'{before,intentDigest}')
      AND (hold#>'{held,effectiveVisibility,publishedPublicationIds}')='[]'::jsonb
      AND (hold#>'{held,effectiveVisibility,onlineStore}')='{"publishedAtPresent":false,"urlPresent":false}'::jsonb)))),false)) OR COALESCE((hold->>'version'='m5-availability-hold-v3' AND m5_v3_hold(hold)
 AND hold->>'operationId'=operation_id AND hold#>>'{before,scope,shopId}'=shop_id),false));
ALTER TABLE m5_availability_resolutions DROP CONSTRAINT m5_014_resolution_version;
ALTER TABLE m5_availability_resolutions ADD CONSTRAINT m5_014_resolution_version CHECK (((jsonb_typeof(resolution)='object'
    AND (resolution->>'version') IS NOT DISTINCT FROM 'm5-availability-resolution-v1'
    AND (resolution#>>'{originalHold,version}') IS NOT DISTINCT FROM 'm5-availability-hold-v1'
    AND (resolution->>'outcome') IS NOT DISTINCT FROM 'ORIGINAL_STATE_OBSERVED'
    AND (resolution->>'shopId') IS NOT DISTINCT FROM shop_id
    AND (resolution->>'configId') IS NOT DISTINCT FROM config_id
    AND (resolution->>'operationId') IS NOT DISTINCT FROM operation_id
    AND (resolution->>'commandKey') IS NOT DISTINCT FROM command_key
    AND (resolution#>>'{currentScope,shopId}') IS NOT DISTINCT FROM shop_id
    AND (resolution#>>'{originalHold,operationId}') IS NOT DISTINCT FROM operation_id
    AND (resolution#>>'{originalHold,before,scope,shopId}') IS NOT DISTINCT FROM shop_id
    AND (resolution#>>'{observed,productId}') IS NOT DISTINCT FROM (resolution#>>'{originalHold,before,productId}')
    AND (resolution#>>'{observed,state}') IS NOT DISTINCT FROM (resolution#>>'{originalHold,before,state}')
    AND (resolution#>>'{observed,visibilityDigest}') IS NOT DISTINCT FROM (resolution#>>'{originalHold,before,visibilityDigest}')
    AND (resolution#>'{observed,scope}') IS NOT DISTINCT FROM (resolution->'currentScope')
    AND (resolution#>>'{decision,version}') IS NOT DISTINCT FROM 'm5-availability-recovery-decision-v1'
    AND (resolution#>>'{decision,outstandingWrites}') IS NOT DISTINCT FROM 'SETTLED_BY_TRUSTED_OPERATOR'
    AND (resolution#>>'{decision,shopId}') IS NOT DISTINCT FROM shop_id
    AND (resolution#>>'{decision,configId}') IS NOT DISTINCT FROM config_id
    AND (resolution#>>'{decision,operationId}') IS NOT DISTINCT FROM operation_id
    AND (resolution#>>'{decision,commandKey}') IS NOT DISTINCT FROM command_key) OR COALESCE((jsonb_typeof(resolution)='object'
    AND (resolution->>'version') IS NOT DISTINCT FROM 'm5-availability-resolution-v2'
    AND (resolution->>'outcome') IS NOT DISTINCT FROM 'ORIGINAL_STATE_OBSERVED'
    AND (resolution->>'shopId') IS NOT DISTINCT FROM shop_id
    AND (resolution->>'configId') IS NOT DISTINCT FROM config_id
    AND (resolution->>'operationId') IS NOT DISTINCT FROM operation_id
    AND (resolution->>'commandKey') IS NOT DISTINCT FROM command_key
    AND (resolution#>>'{currentScope,shopId}') IS NOT DISTINCT FROM shop_id
    AND (resolution#>>'{originalHold,operationId}') IS NOT DISTINCT FROM operation_id
    AND (resolution#>>'{originalHold,before,scope,shopId}') IS NOT DISTINCT FROM shop_id
    AND (resolution#>>'{observed,productId}') IS NOT DISTINCT FROM (resolution#>>'{originalHold,before,productId}')
    AND (resolution#>>'{observed,state}') IS NOT DISTINCT FROM (resolution#>>'{originalHold,before,state}')
    AND (resolution#>'{observed,configuredIntent}') IS NOT DISTINCT FROM (resolution#>'{originalHold,before,configuredIntent}')
    AND (resolution#>>'{observed,intentDigest}') IS NOT DISTINCT FROM (resolution#>>'{originalHold,before,intentDigest}')
    AND (resolution#>>'{observed,effectiveDigest}') IS NOT DISTINCT FROM (resolution#>>'{originalHold,before,effectiveDigest}')
    AND (resolution#>'{observed,effectiveVisibility,publishedPublicationIds}') IS NOT DISTINCT FROM (resolution#>'{originalHold,before,effectiveVisibility,publishedPublicationIds}')
    AND (resolution#>'{observed,effectiveVisibility,onlineStore}') IS NOT DISTINCT FROM (resolution#>'{originalHold,before,effectiveVisibility,onlineStore}')
    AND (resolution#>'{observed,scope}') IS NOT DISTINCT FROM (resolution->'currentScope')
    AND (resolution#>>'{decision,version}') IS NOT DISTINCT FROM 'm5-availability-recovery-decision-v2'
    AND (resolution#>>'{decision,outstandingWrites}') IS NOT DISTINCT FROM 'SETTLED_BY_TRUSTED_OPERATOR'
    AND (resolution#>>'{decision,shopId}') IS NOT DISTINCT FROM shop_id
    AND (resolution#>>'{decision,configId}') IS NOT DISTINCT FROM config_id
    AND (resolution#>>'{decision,operationId}') IS NOT DISTINCT FROM operation_id
    AND (resolution#>>'{decision,commandKey}') IS NOT DISTINCT FROM command_key
    AND (resolution#>>'{originalHold,version}') IS NOT DISTINCT FROM 'm5-availability-hold-v2'
    AND (resolution#>>'{originalHold,before,version}') IS NOT DISTINCT FROM 'm5-product-availability-snapshot-v2'
    AND (resolution#>>'{observed,version}') IS NOT DISTINCT FROM 'm5-product-availability-snapshot-v2'
    AND (resolution#>>'{reviewedObservation,version}') IS NOT DISTINCT FROM 'm5-product-availability-snapshot-v2'
    AND (resolution#>'{reviewedObservation,scope}') IS NOT DISTINCT FROM (resolution->'currentScope')
    AND (resolution#>>'{reviewedObservation,productId}') IS NOT DISTINCT FROM (resolution#>>'{observed,productId}')
    AND (resolution#>>'{reviewedObservation,state}') IS NOT DISTINCT FROM (resolution#>>'{observed,state}')
    AND (resolution#>'{reviewedObservation,configuredIntent}') IS NOT DISTINCT FROM (resolution#>'{observed,configuredIntent}')
    AND (resolution#>>'{reviewedObservation,effectiveDigest}') IS NOT DISTINCT FROM (resolution#>>'{observed,effectiveDigest}')),false)) OR COALESCE((resolution->>'version'='m5-availability-resolution-v3'
 AND resolution->>'outcome'='ORIGINAL_STATE_OBSERVED' AND resolution->>'shopId'=shop_id
 AND resolution->>'configId'=config_id AND resolution->>'operationId'=operation_id AND resolution->>'commandKey'=command_key
 AND resolution#>>'{currentScope,shopId}'=shop_id AND m5_v3_hold(resolution->'originalHold')
 AND resolution#>>'{originalHold,operationId}'=operation_id AND resolution#>>'{originalHold,before,scope,shopId}'=shop_id
 AND resolution#>>'{currentScope,shopifyShopId}'=resolution#>>'{originalHold,before,scope,shopifyShopId}'
 AND resolution#>>'{currentScope,appClientId}'=resolution#>>'{originalHold,before,scope,appClientId}'
 AND m5_v3_same(resolution->'observed',resolution#>'{originalHold,before}',resolution->'currentScope')
 AND m5_v3_same(resolution->'reviewedObservation',resolution->'observed',resolution->'currentScope')
 AND resolution#>>'{decision,version}'='m5-availability-recovery-decision-v3'
 AND resolution#>>'{decision,outstandingWrites}'='SETTLED_BY_TRUSTED_OPERATOR'
 AND resolution#>>'{decision,shopId}'=shop_id AND resolution#>>'{decision,configId}'=config_id
 AND resolution#>>'{decision,operationId}'=operation_id AND resolution#>>'{decision,commandKey}'=command_key),false));

ALTER TABLE m5_activation_evidence ADD CONSTRAINT m5_017_evidence_v3_hold CHECK (
 evidence->>'version'<>'m5-activation-evidence-v3' OR COALESCE((
  (evidence->>'admissionClass'='SAME_MODE' AND evidence->'hold'='null'::jsonb AND evidence->'holdObservation'='null'::jsonb)
  OR (evidence->>'admissionClass' IN ('FIRST_PUBLICATION','MODE_CHANGE')
   AND m5_v3_hold(evidence->'hold') AND evidence#>>'{hold,operationId}'=operation_id
   AND evidence#>>'{hold,before,scope,shopId}'=shop_id
   AND evidence#>>'{hold,before,scope,installationGeneration}'=installation_generation::text
   AND evidence#>>'{hold,before,scope,appClientId}'=evidence#>>'{functionObservation,appClientId}'
   AND evidence#>'{hold,before,visibleScheduledOrStaged}'='[]'::jsonb
   AND m5_v3_held(evidence#>'{hold,held}',evidence#>'{hold,before}')
   AND m5_v3_held(evidence->'holdObservation',evidence#>'{hold,before}')
   AND m5_v3_same(evidence->'holdObservation',evidence#>'{hold,held}',evidence#>'{hold,before,scope}'))
 ),false));
ALTER TABLE m5_activation_state ADD CONSTRAINT m5_017_claim CHECK (
 hold IS NULL OR hold->>'version'<>'m5-availability-hold-v3' OR kind<>'RESTORATION_CLAIMED' OR COALESCE(hold ? 'restorationClaim',false));
CREATE FUNCTION enforce_activation_v3_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE product_id text; shopify_shop_id text; generation text; field text; BEGIN
 IF NEW.hold->>'version'='m5-availability-hold-v3' THEN
  SELECT 'gid://shopify/Product/'||c.external_product_id,'gid://shopify/Shop/'||s.shopify_shop_id,p.installation_generation::text INTO product_id,shopify_shop_id,generation FROM product_configs c JOIN shops s USING(shop_id) JOIN publication_operations p USING(shop_id,config_id) WHERE c.shop_id=NEW.shop_id AND c.config_id=NEW.config_id AND p.operation_id=NEW.operation_id;
  IF NEW.hold#>>'{before,productId}' IS DISTINCT FROM product_id OR NEW.hold#>>'{before,scope,shopifyShopId}' IS DISTINCT FROM shopify_shop_id OR NEW.hold#>>'{before,scope,installationGeneration}' IS DISTINCT FROM generation THEN RAISE EXCEPTION 'v3 availability product binding' USING ERRCODE='check_violation'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD.hold->>'version'='m5-availability-hold-v3' THEN
  FOREACH field IN ARRAY ARRAY['acquisitionAcknowledgement','restorationClaim','restorationReceipt'] LOOP
   IF OLD.hold ? field AND NEW.hold->field IS DISTINCT FROM OLD.hold->field THEN RAISE EXCEPTION 'v3 availability audit is immutable' USING ERRCODE='check_violation'; END IF;
  END LOOP;
  IF (NOT OLD.hold ? 'acquisitionAcknowledgement' AND NEW.hold ? 'acquisitionAcknowledgement' AND NOT (OLD.kind='ACQUISITION_PENDING' AND NEW.kind IN ('HELD','OPERATOR_HOLD')))
   OR (NOT OLD.hold ? 'restorationClaim' AND NEW.hold ? 'restorationClaim' AND NOT (OLD.kind='RESTORATION_PENDING' AND NEW.kind='RESTORATION_CLAIMED'))
   OR (NOT OLD.hold ? 'restorationReceipt' AND NEW.hold ? 'restorationReceipt' AND OLD.kind<>'RESTORATION_CLAIMED')
  THEN RAISE EXCEPTION 'v3 availability audit is out of phase' USING ERRCODE='check_violation'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER m5_activation_v3_audit_guard BEFORE INSERT OR UPDATE ON m5_activation_state FOR EACH ROW EXECUTE FUNCTION enforce_activation_v3_audit();
CREATE FUNCTION enforce_v3_product_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original jsonb; product_id text; shopify_shop_id text; generation text; BEGIN
 IF TG_TABLE_NAME='m5_activation_evidence' THEN
  IF NEW.evidence->>'version'<>'m5-activation-evidence-v3' OR NEW.evidence->'hold'='null'::jsonb THEN RETURN NEW; END IF;
  original:=NEW.evidence#>'{hold,before}';
 ELSE
  IF NEW.resolution->>'version'<>'m5-availability-resolution-v3' THEN RETURN NEW; END IF;
  original:=NEW.resolution#>'{originalHold,before}';
 END IF;
 SELECT 'gid://shopify/Product/'||c.external_product_id,'gid://shopify/Shop/'||s.shopify_shop_id,p.installation_generation::text INTO product_id,shopify_shop_id,generation FROM product_configs c JOIN shops s USING(shop_id) JOIN publication_operations p USING(shop_id,config_id) WHERE c.shop_id=NEW.shop_id AND c.config_id=NEW.config_id AND p.operation_id=NEW.operation_id;
 IF original->>'productId' IS DISTINCT FROM product_id OR original#>>'{scope,shopifyShopId}' IS DISTINCT FROM shopify_shop_id OR original#>>'{scope,installationGeneration}' IS DISTINCT FROM generation THEN RAISE EXCEPTION 'v3 availability product binding' USING ERRCODE='check_violation'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER m5_evidence_v3_product_guard BEFORE INSERT ON m5_activation_evidence FOR EACH ROW EXECUTE FUNCTION enforce_v3_product_binding();
CREATE TRIGGER m5_resolution_v3_product_guard BEFORE INSERT ON m5_availability_resolutions FOR EACH ROW EXECUTE FUNCTION enforce_v3_product_binding();
-- Existing general state/evidence/resolution immutability and tenant foreign keys remain unchanged.

-- migrate:down
DO $$ BEGIN
 IF EXISTS(SELECT FROM m5_activation_evidence WHERE evidence->>'version'='m5-activation-evidence-v3')
 OR EXISTS(SELECT FROM m5_activation_state WHERE hold->>'version'='m5-availability-hold-v3')
 OR EXISTS(SELECT FROM m5_availability_resolutions WHERE resolution->>'version'='m5-availability-resolution-v3')
 THEN RAISE EXCEPTION 'v3 records exist; down migration denied'; END IF;
END $$;
DROP TRIGGER m5_evidence_v3_product_guard ON m5_activation_evidence;
DROP TRIGGER m5_resolution_v3_product_guard ON m5_availability_resolutions;
DROP FUNCTION enforce_v3_product_binding();
DROP TRIGGER m5_activation_v3_audit_guard ON m5_activation_state;
DROP FUNCTION enforce_activation_v3_audit();
ALTER TABLE m5_activation_state DROP CONSTRAINT m5_017_claim;
ALTER TABLE m5_activation_evidence DROP CONSTRAINT m5_017_evidence_v3_hold;
ALTER TABLE m5_activation_evidence DROP CONSTRAINT m5_014_evidence_version;
ALTER TABLE m5_activation_evidence ADD CONSTRAINT m5_014_evidence_version CHECK ((jsonb_typeof(evidence) = 'object'
    AND (evidence->>'version') IS NOT DISTINCT FROM 'm5-activation-evidence-v1') OR COALESCE((jsonb_typeof(evidence) = 'object'
    AND (evidence->>'version') IS NOT DISTINCT FROM 'm5-activation-evidence-v2'),false));
ALTER TABLE m5_activation_evidence DROP CONSTRAINT m5_014_evidence_identity;
ALTER TABLE m5_activation_evidence ADD CONSTRAINT m5_014_evidence_identity CHECK (((evidence->>'version') IS NOT DISTINCT FROM 'm5-activation-evidence-v1' AND (evidence->>'shopId') IS NOT DISTINCT FROM shop_id
    AND (evidence->>'configId') IS NOT DISTINCT FROM config_id
    AND (evidence->>'operationId') IS NOT DISTINCT FROM operation_id
    AND (evidence->>'revisionId') IS NOT DISTINCT FROM revision_id
    AND (evidence->>'installationGeneration') IS NOT DISTINCT FROM installation_generation::text
    AND (evidence->>'operationSequence') IS NOT DISTINCT FROM operation_sequence::text
    AND (evidence->>'authorizationGeneration') IS NOT DISTINCT FROM authorization_generation::text
    AND (evidence->'authorizationEpoch') IS NOT DISTINCT FROM to_jsonb(authorization_epoch)
    AND (evidence->'selectedKeyId') IS NOT DISTINCT FROM to_jsonb(selected_key_id)
    AND (evidence->'decisionVersion') IS NOT DISTINCT FROM '1'::jsonb) OR COALESCE(((evidence->>'version') IS NOT DISTINCT FROM 'm5-activation-evidence-v2' AND ((evidence->>'shopId') IS NOT DISTINCT FROM shop_id
    AND (evidence->>'configId') IS NOT DISTINCT FROM config_id
    AND (evidence->>'operationId') IS NOT DISTINCT FROM operation_id
    AND (evidence->>'revisionId') IS NOT DISTINCT FROM revision_id
    AND (evidence->>'installationGeneration') IS NOT DISTINCT FROM installation_generation::text
    AND (evidence->>'operationSequence') IS NOT DISTINCT FROM operation_sequence::text
    AND (evidence->>'authorizationGeneration') IS NOT DISTINCT FROM authorization_generation::text
    AND (evidence->'authorizationEpoch') IS NOT DISTINCT FROM to_jsonb(authorization_epoch)
    AND (evidence->'selectedKeyId') IS NOT DISTINCT FROM to_jsonb(selected_key_id)
    AND (evidence->'decisionVersion') IS NOT DISTINCT FROM '2'::jsonb)),false));
ALTER TABLE m5_activation_state DROP CONSTRAINT m5_014_hold_version;
ALTER TABLE m5_activation_state ADD CONSTRAINT m5_014_hold_version CHECK ((hold IS NULL OR ((hold->>'version') IS NOT DISTINCT FROM 'm5-availability-hold-v1'
    AND (hold->>'operationId') IS NOT DISTINCT FROM operation_id
    AND jsonb_typeof(hold->'before') IS NOT DISTINCT FROM 'object'
    AND (hold#>>'{before,scope,shopId}') IS NOT DISTINCT FROM shop_id)) OR COALESCE((hold IS NULL OR (((hold->>'version') IS NOT DISTINCT FROM 'm5-availability-hold-v2'
    AND (hold->>'operationId') IS NOT DISTINCT FROM operation_id
    AND jsonb_typeof(hold->'before') IS NOT DISTINCT FROM 'object'
    AND (hold#>>'{before,scope,shopId}') IS NOT DISTINCT FROM shop_id)
    AND (hold#>>'{before,version}') IS NOT DISTINCT FROM 'm5-product-availability-snapshot-v2'
    AND COALESCE((hold#>>'{before,intentDigest}') ~ '^[a-f0-9]{64}$',false)
    AND COALESCE((hold#>>'{before,effectiveDigest}') ~ '^[a-f0-9]{64}$',false)
    AND jsonb_typeof(hold#>'{before,configuredIntent,includedPublicationIds}') IS NOT DISTINCT FROM 'array'
    AND jsonb_typeof(hold#>'{before,configuredIntent,publicationSettings}') IS NOT DISTINCT FROM 'array'
    AND jsonb_typeof(hold#>'{before,configuredIntent,scheduled}') IS NOT DISTINCT FROM 'array'
    AND jsonb_typeof(hold#>'{before,effectiveVisibility,publishedPublicationIds}') IS NOT DISTINCT FROM 'array'
    AND (hold->'held'='null'::jsonb OR (jsonb_typeof(hold->'held')='object'
      AND (hold#>>'{held,version}') IS NOT DISTINCT FROM 'm5-product-availability-snapshot-v2'
      AND (hold#>'{held,scope}') IS NOT DISTINCT FROM (hold#>'{before,scope}')
      AND (hold#>>'{held,productId}') IS NOT DISTINCT FROM (hold#>>'{before,productId}')
      AND (hold#>>'{held,state}') IS NOT DISTINCT FROM 'unavailable'
      AND (hold#>'{held,configuredIntent}') IS NOT DISTINCT FROM (hold#>'{before,configuredIntent}')
      AND (hold#>>'{held,intentDigest}') IS NOT DISTINCT FROM (hold#>>'{before,intentDigest}')
      AND (hold#>'{held,effectiveVisibility,publishedPublicationIds}')='[]'::jsonb
      AND (hold#>'{held,effectiveVisibility,onlineStore}')='{"publishedAtPresent":false,"urlPresent":false}'::jsonb)))),false));
ALTER TABLE m5_availability_resolutions DROP CONSTRAINT m5_014_resolution_version;
ALTER TABLE m5_availability_resolutions ADD CONSTRAINT m5_014_resolution_version CHECK ((jsonb_typeof(resolution)='object'
    AND (resolution->>'version') IS NOT DISTINCT FROM 'm5-availability-resolution-v1'
    AND (resolution#>>'{originalHold,version}') IS NOT DISTINCT FROM 'm5-availability-hold-v1'
    AND (resolution->>'outcome') IS NOT DISTINCT FROM 'ORIGINAL_STATE_OBSERVED'
    AND (resolution->>'shopId') IS NOT DISTINCT FROM shop_id
    AND (resolution->>'configId') IS NOT DISTINCT FROM config_id
    AND (resolution->>'operationId') IS NOT DISTINCT FROM operation_id
    AND (resolution->>'commandKey') IS NOT DISTINCT FROM command_key
    AND (resolution#>>'{currentScope,shopId}') IS NOT DISTINCT FROM shop_id
    AND (resolution#>>'{originalHold,operationId}') IS NOT DISTINCT FROM operation_id
    AND (resolution#>>'{originalHold,before,scope,shopId}') IS NOT DISTINCT FROM shop_id
    AND (resolution#>>'{observed,productId}') IS NOT DISTINCT FROM (resolution#>>'{originalHold,before,productId}')
    AND (resolution#>>'{observed,state}') IS NOT DISTINCT FROM (resolution#>>'{originalHold,before,state}')
    AND (resolution#>>'{observed,visibilityDigest}') IS NOT DISTINCT FROM (resolution#>>'{originalHold,before,visibilityDigest}')
    AND (resolution#>'{observed,scope}') IS NOT DISTINCT FROM (resolution->'currentScope')
    AND (resolution#>>'{decision,version}') IS NOT DISTINCT FROM 'm5-availability-recovery-decision-v1'
    AND (resolution#>>'{decision,outstandingWrites}') IS NOT DISTINCT FROM 'SETTLED_BY_TRUSTED_OPERATOR'
    AND (resolution#>>'{decision,shopId}') IS NOT DISTINCT FROM shop_id
    AND (resolution#>>'{decision,configId}') IS NOT DISTINCT FROM config_id
    AND (resolution#>>'{decision,operationId}') IS NOT DISTINCT FROM operation_id
    AND (resolution#>>'{decision,commandKey}') IS NOT DISTINCT FROM command_key) OR COALESCE((jsonb_typeof(resolution)='object'
    AND (resolution->>'version') IS NOT DISTINCT FROM 'm5-availability-resolution-v2'
    AND (resolution->>'outcome') IS NOT DISTINCT FROM 'ORIGINAL_STATE_OBSERVED'
    AND (resolution->>'shopId') IS NOT DISTINCT FROM shop_id
    AND (resolution->>'configId') IS NOT DISTINCT FROM config_id
    AND (resolution->>'operationId') IS NOT DISTINCT FROM operation_id
    AND (resolution->>'commandKey') IS NOT DISTINCT FROM command_key
    AND (resolution#>>'{currentScope,shopId}') IS NOT DISTINCT FROM shop_id
    AND (resolution#>>'{originalHold,operationId}') IS NOT DISTINCT FROM operation_id
    AND (resolution#>>'{originalHold,before,scope,shopId}') IS NOT DISTINCT FROM shop_id
    AND (resolution#>>'{observed,productId}') IS NOT DISTINCT FROM (resolution#>>'{originalHold,before,productId}')
    AND (resolution#>>'{observed,state}') IS NOT DISTINCT FROM (resolution#>>'{originalHold,before,state}')
    AND (resolution#>'{observed,configuredIntent}') IS NOT DISTINCT FROM (resolution#>'{originalHold,before,configuredIntent}')
    AND (resolution#>>'{observed,intentDigest}') IS NOT DISTINCT FROM (resolution#>>'{originalHold,before,intentDigest}')
    AND (resolution#>>'{observed,effectiveDigest}') IS NOT DISTINCT FROM (resolution#>>'{originalHold,before,effectiveDigest}')
    AND (resolution#>'{observed,effectiveVisibility,publishedPublicationIds}') IS NOT DISTINCT FROM (resolution#>'{originalHold,before,effectiveVisibility,publishedPublicationIds}')
    AND (resolution#>'{observed,effectiveVisibility,onlineStore}') IS NOT DISTINCT FROM (resolution#>'{originalHold,before,effectiveVisibility,onlineStore}')
    AND (resolution#>'{observed,scope}') IS NOT DISTINCT FROM (resolution->'currentScope')
    AND (resolution#>>'{decision,version}') IS NOT DISTINCT FROM 'm5-availability-recovery-decision-v2'
    AND (resolution#>>'{decision,outstandingWrites}') IS NOT DISTINCT FROM 'SETTLED_BY_TRUSTED_OPERATOR'
    AND (resolution#>>'{decision,shopId}') IS NOT DISTINCT FROM shop_id
    AND (resolution#>>'{decision,configId}') IS NOT DISTINCT FROM config_id
    AND (resolution#>>'{decision,operationId}') IS NOT DISTINCT FROM operation_id
    AND (resolution#>>'{decision,commandKey}') IS NOT DISTINCT FROM command_key
    AND (resolution#>>'{originalHold,version}') IS NOT DISTINCT FROM 'm5-availability-hold-v2'
    AND (resolution#>>'{originalHold,before,version}') IS NOT DISTINCT FROM 'm5-product-availability-snapshot-v2'
    AND (resolution#>>'{observed,version}') IS NOT DISTINCT FROM 'm5-product-availability-snapshot-v2'
    AND (resolution#>>'{reviewedObservation,version}') IS NOT DISTINCT FROM 'm5-product-availability-snapshot-v2'
    AND (resolution#>'{reviewedObservation,scope}') IS NOT DISTINCT FROM (resolution->'currentScope')
    AND (resolution#>>'{reviewedObservation,productId}') IS NOT DISTINCT FROM (resolution#>>'{observed,productId}')
    AND (resolution#>>'{reviewedObservation,state}') IS NOT DISTINCT FROM (resolution#>>'{observed,state}')
    AND (resolution#>'{reviewedObservation,configuredIntent}') IS NOT DISTINCT FROM (resolution#>'{observed,configuredIntent}')
    AND (resolution#>>'{reviewedObservation,effectiveDigest}') IS NOT DISTINCT FROM (resolution#>>'{observed,effectiveDigest}')),false));
DROP FUNCTION m5_v3_hold(jsonb);
DROP FUNCTION m5_v3_mismatch(jsonb,jsonb);
DROP FUNCTION m5_v3_ack_qualified(jsonb);
DROP FUNCTION m5_v3_ack(jsonb,jsonb,text);
DROP FUNCTION m5_v3_held(jsonb,jsonb);
DROP FUNCTION m5_v3_same(jsonb,jsonb,jsonb);
DROP FUNCTION m5_v3_snapshot(jsonb);
DROP FUNCTION m5_v3_facts(jsonb);
DROP FUNCTION m5_v3_keys(jsonb,text[],text[]);
DROP FUNCTION m5_v3_ids(jsonb,integer);
DROP FUNCTION m5_v3_digest(jsonb);
DROP FUNCTION m5_v3_json(jsonb);
