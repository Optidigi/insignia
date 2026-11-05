import { adminMessage, createAdminLocaleController, createAdminTranslator } from '../src/admin.js';
import { createCustomerLocaleController, createCustomerTranslator, customerMessage } from '../src/customer.js';
import { createGuestTranslator } from '../src/guest.js';
import { createPreactLocaleBindings } from '../src/preact.js';

const admin = createAdminTranslator('en');
const customer = createCustomerTranslator('en');
const guest = createGuestTranslator('en');
const removal = customerMessage('common:resources.remove', { resourceName: 'View' });
const adminBindings = createPreactLocaleBindings(createAdminTranslator);
const customerBindings = createPreactLocaleBindings(createCustomerTranslator);
const adminController = createAdminLocaleController('en');
const customerController = createCustomerLocaleController('en');

admin.t('admin-preview:preview.documentTitle');
customer.t('customer:steps.addToCart');
customer.t('customer:quantities.quantityCount', { count: 3 });
customer.t('common:resources.remove', { resourceName: 'View' });
customer.t('common:counts.exactTotal', { formattedCount: '9,007,199,254,740,992' });
admin.message(adminMessage('common:resources.remove', { resourceName: 'Product' }));
customer.message(removal);
guest.t('common:actions.retry');

// @ts-expect-error Interpolation values are required.
customer.t('customer:quantities.useWholeNumbers');
// @ts-expect-error Count must be numeric and present for plural selection.
customer.t('customer:quantities.quantityCount', { count: 'two' });
// @ts-expect-error Formatted BigInt count text remains a string.
customer.t('common:counts.exactTotal', { formattedCount: 9007199254740992 });
// @ts-expect-error Admin preview messages are excluded from the customer entry.
customer.t('admin-preview:preview.documentTitle');
// @ts-expect-error Resource names are required.
customer.t('common:resources.remove');
// @ts-expect-error Descriptor parameters stay required when state stores a message.
customerMessage('common:resources.remove');
// @ts-expect-error Customer messages are excluded from the guest entry.
guest.t('customer:steps.addToCart');

void admin;
void customer;
void guest;
void adminBindings.LocaleProvider;
void adminBindings.useLocale;
void customerBindings.LocaleProvider;
void customerBindings.useLocale;
void adminController;
void customerController;
