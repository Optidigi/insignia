/** Presentation follows the rendered legacy reference; commerce uses the current buyer flow. */
export const customizerCss = `
:host{font:16px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#111827;line-height:1.5}
*{box-sizing:border-box}
button,select,input{font:inherit}
button{cursor:pointer;background:#fff;border:1px solid #d1d5db;border-radius:8px;min-height:44px;padding:10px 16px;color:inherit}
button:hover{background:#f9fafb}
button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #2563eb;outline-offset:2px}
button:disabled{opacity:.5;cursor:not-allowed}
select{width:100%;border:1px solid #d1d5db;border-radius:8px;padding:10px;background:#fff}
input{accent-color:#2563eb}

dialog{position:fixed;inset:0;margin:0;width:100%;height:100dvh;max-width:none;max-height:none;border:0;border-radius:0;padding:0;background:#fff;color:#111827;overflow:hidden}
dialog[open]{display:flex;flex-direction:column}
dialog::backdrop{background:#0008}
.modal-header{height:64px;min-height:64px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;padding:0 24px;gap:16px}
.modal-header .wizard{margin:0;flex:1;max-width:500px}
.modal-header h2{font-size:16px;margin:0}
.close-customizer{border:0;background:#f3f4f6;font-size:13px}
.modal-layout{min-height:0;flex:1;display:grid;grid-template-columns:60% 40%;overflow:hidden}
.preview-panel{min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:32px;background:#f9fafb;overflow:auto}
.preview{width:100%;max-width:640px;aspect-ratio:1;background:white;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;flex-shrink:0}
.customization-content{min-width:0;overflow-y:auto;padding:24px 24px 112px;border-left:1px solid #e5e7eb;position:relative}
.customization-content>p:empty{display:none}
h3{font-size:18px;margin:0 0 8px}
h4{margin-bottom:8px}
p{font-size:14px;color:#6b7280}
fieldset{border:0;padding:0;margin:0;min-width:0}
fieldset>section{margin:20px 0}
fieldset legend{font-size:12px;font-weight:600;color:#374151;margin-bottom:10px}
label{display:block;margin:10px 0}
.row{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}
.wizard{display:flex;gap:8px;list-style:none;padding:0;margin:0 0 24px;justify-content:space-between;font-size:12px;color:#9ca3af}
.wizard li{padding:12px 0;flex:1;text-align:center;border-bottom:2px solid transparent}
.wizard [aria-current=step]{font-weight:600;color:#2563eb;border-color:#2563eb}

.card{padding:16px;border:1px solid #e5e7eb;border-radius:12px;display:flex;align-items:center;gap:12px;min-height:64px;background:#fff;width:100%;text-align:left}
.card:has(input:checked),.card[aria-pressed=true]{border-color:#2563eb;background:#eff6ff}
.card input{width:18px;height:18px;flex-shrink:0}
.method-choices{margin:20px 0}
.method-card{font-size:14px;font-weight:600}
.badge{color:#92400e;background:#fffbeb;padding:6px 10px;border-radius:8px;font-size:12px}
.reassurance{background:#f9fafb;padding:20px;border:1px solid #e5e7eb;border-radius:12px}
.or{display:flex;align-items:center;gap:16px}
.or:before,.or:after{content:"";height:1px;background:#e5e7eb;flex:1}
.quantity-card{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid #e5e7eb;border-radius:12px;padding:12px 16px;margin:10px 0;font-size:14px}
.quantity-stepper{display:flex;align-items:center;flex-shrink:0}
.quantity-stepper button{padding:6px 12px}
.quantity-stepper input{width:54px;height:44px;text-align:center;border:0;background:transparent;-moz-appearance:textfield}
.quantity-stepper input::-webkit-inner-spin-button{appearance:none}
.quantity-card label{margin:0}
.step-footer{position:fixed;bottom:0;right:0;width:40%;background:#fff;border-top:1px solid #e5e7eb;margin:0;padding:16px 24px;display:flex;justify-content:flex-end;gap:12px;z-index:2;min-height:77px}
.next-step{background:#2563eb;color:white;border-color:#2563eb}
.next-step:hover{background:#1d4ed8}
.back{margin-right:auto;background:#f3f4f6;border:0}
.total{background:linear-gradient(120deg,#1e3a8a,#2563eb);color:#fff;padding:20px;border-radius:12px;font-size:16px}
.total strong{font-size:24px}
.step-footer>.add-cart{width:auto;flex:1}
.add-cart{background:#059669;color:white;border:0;width:100%;font-weight:600}
.add-cart:hover{background:#047857}
table{width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed}
td,th{padding:8px 3px;text-align:left;border-bottom:1px solid #e5e7eb;overflow-wrap:anywhere}
.error{color:#b91c1c;background:#fef2f2;padding:12px;border-radius:8px}
input[type=range]{width:100%;touch-action:pan-y;min-height:44px}
.view-controls button[aria-pressed=true]{background:#eff6ff;border-color:#2563eb}
.confirm-backdrop{position:absolute;inset:0;background:#0006;display:grid;place-items:center;padding:20px;z-index:5}
.confirm-close{background:#fff;border-radius:16px;padding:24px;max-width:420px;box-shadow:0 20px 25px #0002}
.confirm-close button{flex:1}

[aria-label="Private artwork"]>h3{display:none}
[aria-label="Private artwork"]>label{display:block;padding:24px 16px;background:#eff6ff;border:2px dashed #bfdbfe;border-radius:12px;text-align:center;font-size:14px;font-weight:600}
[aria-label="Private artwork"] input[type=file]{display:block;max-width:100%;width:100%;margin-top:12px;font-size:12px}
[aria-label="Private artwork"] input::file-selector-button{background:white;border:1px solid #bfdbfe;border-radius:8px;padding:10px;color:#1d4ed8;cursor:pointer}

@media(max-width:1023px){.modal-header{height:56px;min-height:56px;padding:0 16px}
.modal-header .wizard{margin:0;flex:1;max-width:500px}
.modal-header h2{display:none}
.modal-header .wizard{font-size:10px;gap:0}
.modal-header .wizard li{padding:12px 2px}
.close-customizer{max-width:82px}
.close-customizer{font-size:12px;padding:8px}
.modal-layout{display:block;overflow-y:auto}
.preview-panel{display:none;padding:16px}
.preview-panel[data-mobile-visible=true]{display:flex}
.preview{max-width:480px}
.customization-content{border:0;overflow:visible;padding:16px 16px 104px;min-height:100%;display:flex;flex-direction:column}
.wizard{margin-bottom:12px}
.step-footer{position:fixed;bottom:0;width:100%;margin:0;padding:12px 16px;min-height:72px}
.quantity-card{padding:10px;font-size:13px}
.quantity-stepper input{width:42px}
.quantity-stepper button{padding:6px 10px}
.preview-panel[data-mobile-visible=true]+.customization-content{min-height:0}
}

@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}
}


.preview-canvas{height:100%;width:100%;transform-origin:0 0;transition:transform 200ms cubic-bezier(.2,.8,.2,1)}
.preview-trigger{display:none}
.preview-backdrop{position:fixed;inset:0;z-index:4;border:0;border-radius:0;background:#0006}
.preview-backdrop:hover{background:#0006}
.preview-panel[data-sheet-open=true]{position:fixed;inset:auto 0 0;z-index:6;height:min(85dvh,720px);display:flex;justify-content:flex-start;background:#fff;border-radius:20px 20px 0 0;padding:16px;box-shadow:0 -10px 40px #0002}
.sheet-header{display:flex;align-items:center;justify-content:space-between;width:100%;flex-wrap:wrap;gap:12px;flex-shrink:0}
.sheet-header h3{margin:0;font-size:16px}.sheet-header button{font-size:12px}.sheet-handle{flex-basis:100%;min-height:20px;border:0;background:transparent;padding:0;touch-action:none}.sheet-handle:after{content:"";display:block;width:40px;height:4px;border-radius:8px;background:#d1d5db;margin:auto}
.artwork-upload [aria-label="Private artwork"]>label{position:relative;min-height:165px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:0;gap:12px}
.artwork-upload [aria-label="Private artwork"]>label:before{content:"";display:block;width:32px;height:32px;background:center/contain no-repeat url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' fill='none' stroke='%232563eb' stroke-width='2' viewBox='0 0 32 32'%3E%3Cpath d='M9 23H7a5 5 0 0 1-1-10 10 10 0 0 1 19-2 6 6 0 0 1 0 12h-2M16 27V13m-5 5 5-5 5 5'/%3E%3C/svg%3E")}
.artwork-upload [aria-label="Private artwork"]>label:after{content:"Tap to upload your logo";font-size:14px}
.artwork-upload [aria-label="Private artwork"] input[type=file]{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;margin:0}
.artwork-upload [aria-label="Private artwork"]>label:has(input:focus-visible){outline:2px solid #2563eb;outline-offset:2px}
@media(max-width:1023px){.preview-trigger{display:inline-flex;gap:8px;margin:12px 0}.preview-panel[data-sheet-open=true] .preview{max-width:480px}}
@media(prefers-reduced-motion:reduce){.preview-canvas{transition:none}}

.wizard li{display:flex;align-items:center;justify-content:center;gap:6px}.wizard svg{flex-shrink:0}.close-customizer{display:grid;place-items:center;min-width:36px;min-height:36px;padding:8px}.method-card input{order:2;margin-left:auto}.later-icon{display:grid;place-items:center;background:#f3f4f6;color:#6b7280;border-radius:50%;width:32px;height:32px;flex-shrink:0}.later-chevron{margin-left:auto;color:#9ca3af}
@media(max-width:1023px){.wizard li{flex-direction:column;gap:3px}.modal-header .wizard{font-size:11px}.modal-header .wizard li{padding:8px 2px}.modal-header{gap:8px}.close-customizer{max-width:none}}

.wizard li[data-completed=true]{color:#10b981}.wizard li[data-completed=true] svg{color:#10b981}
.control-card{border:1px solid #e5e7eb;border-radius:12px;background:#fff;padding:16px;font-size:12px;color:#374151}.placement-title{text-align:center;font-size:16px;margin:16px 0}.method-setting{font-size:11px;text-transform:uppercase;letter-spacing:.03em}.method-setting select{margin-top:8px;text-transform:none;letter-spacing:normal;font-size:14px;border:0;padding:0 24px 0 0}.size-label{display:flex;justify-content:space-between;gap:12px;text-transform:uppercase;font-size:11px;font-weight:600}.size-label strong{text-transform:none;color:#111827;font-size:14px}.size-setting{display:block;padding:18px 16px}.range-labels{display:flex;justify-content:space-between;gap:8px;color:#6b7280;font-size:11px}.range-labels [data-selected=true]{color:#2563eb;font-weight:600}.size-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.size-cards legend{padding-bottom:8px}.size-card{position:relative;min-height:94px;flex-direction:column;justify-content:center;font-size:14px;font-weight:600}.size-card input{position:absolute;right:10px;top:10px;width:16px;height:16px}.size-card>span{font-size:11px;font-weight:400;color:#6b7280}.placement-tabs{border-bottom:1px solid #e5e7eb;padding-bottom:12px}.placement-tabs button{font-size:12px;flex:1}.placement-tabs button[aria-pressed=true]{background:#eff6ff;border-color:#2563eb;color:#1d4ed8}
.design-summary{border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;margin:16px 0;background:#fff;font-size:13px}.summary-artwork{display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid #e5e7eb}.summary-artwork>div{display:flex;flex-direction:column;gap:3px}.summary-artwork strong{text-transform:uppercase;font-size:10px;letter-spacing:.05em;color:#b45309}.summary-artwork span{font-size:12px}.artwork-mark{display:grid;place-items:center;width:44px;height:44px;flex-shrink:0;background:#fffbeb;border:1px solid #fbbf24;border-radius:8px;font-size:22px!important;color:#b45309}.summary-row,.summary-section{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 16px;border-bottom:1px solid #e5e7eb}.summary-row>span:first-child{display:flex;align-items:center;gap:8px}.summary-row>span:last-child{font-size:11px;color:#6b7280;text-align:right}.summary-row>strong{font-size:12px;text-align:right}.summary-section{background:#f9fafb;color:#374151;font-size:10px;text-transform:uppercase;letter-spacing:.03em}.summary-section>span{font-size:11px;color:#6b7280;text-transform:none;letter-spacing:normal}.summary-final{font-weight:600;background:#f9fafb;border:0}.summary-final>span{font-weight:400}.design-summary dl{margin:0}.design-summary dd{margin:0;font-weight:600;text-align:right}.artwork-note{padding:14px 16px;background:#fffbeb;color:#92400e;border:1px solid #fcd34d;border-radius:12px;font-size:12px}.artwork-note strong{display:block;margin-bottom:4px}.price-summaries .summary-final{font-size:14px}
.quantity-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:20px}.quantity-grid>legend{padding-bottom:8px}.quantity-card{min-width:0;flex-direction:column;padding:12px 6px;margin:0;font-size:13px;text-align:center;gap:12px}.quantity-card[data-selected=true]{background:#f9fafb;border:2px solid #d1d5db;padding:11px 5px}.quantity-stepper{width:100%;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;background:#fff}.quantity-stepper button{border:0;border-radius:0;padding:0;min-width:0;min-height:36px;font-size:14px}.quantity-stepper input{height:36px;width:100%;min-width:0;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;font-size:13px}.quantity-card label{font-weight:600;overflow-wrap:anywhere}
@media(min-width:1440px){.quantity-grid{display:block;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden}.quantity-grid>legend{padding:0 0 8px}.quantity-card{display:flex;flex-direction:row;border:0;border-bottom:1px solid #e5e7eb;border-radius:0;padding:12px 16px;text-align:left}.quantity-card[data-selected=true]{padding:12px 13px;border:0;border-left:3px solid #2563eb}.quantity-card:last-child{border-bottom:0}.quantity-stepper{width:104px}}
@media(max-width:1023px){[aria-label="Garment quantity review"]>h3,[aria-label="Decoration sizing"]>h3{display:none}.summary-artwork{padding:12px}.summary-row,.summary-section{padding:12px}.summary-row{gap:10px}.summary-row>span:last-child{max-width:48%}}

.method-setting-single{text-align:center;font-size:12px;color:#6b7280;margin:4px 0 12px}.step-footer .preview-trigger{margin:0;min-width:44px;align-items:center;justify-content:center;padding:10px;background:#eff6ff;color:#2563eb;border:0}
`;
