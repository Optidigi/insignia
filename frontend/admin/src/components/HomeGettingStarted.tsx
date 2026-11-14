import { formatExactCount } from '@insignia/ui-localization/core';
import type { ComponentChildren, RefObject } from 'preact';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useAdminLocale } from '../shared/admin-i18n.js';
import { type HomeGuidance, type HomeGuidanceStepId, homeGuidanceStepIds } from '../shared/merchant-home.js';
import '../styles/home-getting-started.css';

const steps = [
  {
    id: 'product',
    href: '/admin/products',
  },
  {
    id: 'storefront',
    href: '/admin/settings/storefront',
  },
  {
    id: 'test',
    href: '/admin/settings/storefront#test-product',
  },
] as const;

export default function HomeGettingStarted({
  guidance,
  onDismiss,
  onCompleteStep,
  preferredStep,
  productStep,
  testReady = false,
  toggleRef,
}: {
  testReady?: boolean;
  toggleRef?: RefObject<HTMLElementTagNameMap['s-button']>;
  guidance: HomeGuidance;
  preferredStep?: HomeGuidanceStepId;
  productStep?: {
    title?: string;
    description?: string;
    action?: string;
    href?: string;
    context?: string;
    content?: ComponentChildren;
  };
  onDismiss?: () => void;
  onCompleteStep?: (step: HomeGuidanceStepId, complete: boolean) => void;
}) {
  const { t, formatLocale } = useAdminLocale();
  const completed = guidance.completedSteps ?? [];
  const observed = guidance.observedSteps ?? [];
  const [expanded, setExpanded] = useState(completed.length < 3 && (guidance.initiallyExpanded ?? true));
  const [activeStep, setActiveStep] = useState<HomeGuidanceStepId | undefined>(() =>
    preferredStep && !completed.includes(preferredStep)
      ? preferredStep
      : homeGuidanceStepIds.find((id) => !completed.includes(id)),
  );
  const observedKey = observed.join();
  useEffect(() => {
    // A step proven done after mount must not stay highlighted as the one to work on.
    if (activeStep && observed.includes(activeStep))
      setActiveStep(
        preferredStep && !completed.includes(preferredStep)
          ? preferredStep
          : homeGuidanceStepIds.find((id) => !completed.includes(id)),
      );
  }, [observedKey]);
  useEffect(() => {
    if (preferredStep)
      setActiveStep(
        completed.includes(preferredStep) ? homeGuidanceStepIds.find((id) => !completed.includes(id)) : preferredStep,
      );
  }, [preferredStep]);
  const contentId = `home-getting-started-${useId()}`;
  const localToggle = useRef<HTMLElementTagNameMap['s-button']>(null);
  const toggle = toggleRef ?? localToggle;
  const pendingFocus = useRef<'guide' | null>(null);
  useEffect(
    () => setExpanded(completed.length < 3 && (guidance.initiallyExpanded ?? true)),
    [guidance.initiallyExpanded],
  );
  useEffect(() => {
    if (completed.length === 3) setExpanded(false);
  }, [completed.length]);
  useLayoutEffect(() => {
    toggle.current?.setAttribute('aria-expanded', String(expanded));
    toggle.current?.setAttribute('aria-controls', contentId);
    if (pendingFocus.current === 'guide' && !guidance.dismissed) {
      toggle.current?.focus();
      pendingFocus.current = null;
    }
  });
  if (guidance.dismissed) return null;
  const completedCount = formatExactCount(BigInt(completed.length), formatLocale).formatted;
  const totalCount = formatExactCount(BigInt(homeGuidanceStepIds.length), formatLocale).formatted;
  return (
    <s-section data-home-section="guidance">
      <div class="home-guide" data-expanded={expanded}>
        <div class="home-guide__header">
          <div class="home-guide__heading">
            <s-heading>
              {completed.length === homeGuidanceStepIds.length
                ? t('home:guidance.complete')
                : t('home:guidance.heading')}
            </s-heading>
            <div class="home-guide__progress">
              <progress
                max={homeGuidanceStepIds.length}
                value={completed.length}
                aria-label={t('home:guidance.progress')}
              />
              <s-text color="subdued" fontSize="small">
                {t('home:guidance.completedCount', { completed: completedCount, total: totalCount })}
              </s-text>
            </div>
          </div>
          <div class="home-guide__controls">
            {onDismiss && (
              <s-button
                variant="tertiary"
                icon="x"
                accessibilityLabel={t('home:guidance.dismiss')}
                onClick={onDismiss}
              />
            )}
            <s-button
              ref={toggle}
              variant="tertiary"
              icon={expanded ? 'chevron-up' : 'chevron-down'}
              accessibilityLabel={expanded ? t('home:guidance.hide') : t('home:guidance.show')}
              onClick={() => setExpanded(!expanded)}
            />
          </div>
        </div>
        <div id={contentId} hidden={!expanded}>
          <ul class="home-guide__steps">
            {steps.map((baseStep, index) => {
              const step = baseStep;
              const productCopy = baseStep.id === 'product' ? productStep : undefined;
              const testBlocked = step.id === 'test' && !testReady;
              const title = productCopy?.title ?? t(`home:guidance.steps.${step.id}`);
              const description =
                step.id === 'product'
                  ? (productCopy?.description ?? t('home:products.customizeBody'))
                  : t(`home:guidance.${step.id}.description`);
              const actionLabel =
                step.id === 'product'
                  ? (productCopy?.action ?? t('home:products.configure'))
                  : t(`home:guidance.${step.id}.action`);
              const context = baseStep.id === 'product' ? productStep?.context : undefined;
              const actionContent = baseStep.id === 'product' ? productStep?.content : undefined;
              const complete = completed.includes(step.id);
              const locked = observed.includes(step.id);
              const active = activeStep === step.id;
              const detailId = `${contentId}-${step.id}`;
              return (
                <li key={step.id}>
                  {index > 0 && <s-divider />}
                  <s-box borderRadius="base" {...(active ? { background: 'subdued' as const } : {})}>
                    <div class="home-guide__step">
                      <div class="home-guide__step-header">
                        <label class="home-guide__check-hit">
                          <input
                            type="checkbox"
                            class={locked ? 'home-guide__check home-guide__check--observed' : 'home-guide__check'}
                            checked={complete}
                            disabled={!onCompleteStep || locked}
                            aria-label={t(
                              locked
                                ? 'home:guidance.observedComplete'
                                : complete
                                  ? 'home:guidance.markIncomplete'
                                  : 'home:guidance.markComplete',
                              { step: t(`home:guidance.stepLabels.${step.id}`) },
                            )}
                            onChange={() => {
                              if (!complete && completed.length === 2) pendingFocus.current = 'guide';
                              onCompleteStep?.(step.id, !complete);
                              if (!complete && active)
                                setActiveStep(
                                  homeGuidanceStepIds.find((id) => id !== step.id && !completed.includes(id)),
                                );
                            }}
                          />
                        </label>
                        <button
                          class="home-guide__step-toggle"
                          type="button"
                          aria-expanded={active}
                          aria-controls={detailId}
                          onClick={() => setActiveStep(active ? undefined : step.id)}
                        >
                          <s-text fontWeight="medium">{title}</s-text>
                          <s-icon type={active ? 'chevron-up' : 'chevron-down'} />
                        </button>
                      </div>
                      {locked && (
                        <div class="home-guide__observed">
                          <s-text color="subdued" fontSize="small">
                            {t('home:guidance.observedNote')}
                          </s-text>
                        </div>
                      )}
                      <div class="home-guide__detail" id={detailId} hidden={!active}>
                        <div
                          class={
                            step.id === 'storefront'
                              ? 'home-guide__detail-content home-guide__detail-content--illustrated'
                              : 'home-guide__detail-content'
                          }
                        >
                          <s-stack gap="base">
                            {context && (
                              <div class="home-guide__context">
                                <s-text color="subdued">{context}</s-text>
                              </div>
                            )}
                            <s-paragraph>{testBlocked ? t('home:guidance.test.blocked') : description}</s-paragraph>
                            <div class="home-guide__action">
                              {actionContent ?? (
                                <s-button
                                  variant="primary"
                                  href={testBlocked ? undefined : (productCopy?.href ?? step.href)}
                                  disabled={testBlocked}
                                >
                                  {actionLabel}
                                </s-button>
                              )}
                            </div>
                          </s-stack>
                          {step.id === 'storefront' && (
                            <div class="home-guide__illustration" aria-hidden="true">
                              <s-image
                                src="https://cdn.shopify.com/s/assets/admin/checkout/settings-customizecart-705f57c725ac05be5a34ec20c05b94298cb8afd10aac7bd9c7ad02030f48cfa0.svg"
                                alt=""
                                aspectRatio="1/1"
                                objectFit="contain"
                                loading="lazy"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </s-box>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </s-section>
  );
}
