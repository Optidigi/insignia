import {defineMiddleware} from 'astro:middleware';
import {ensureCustomerArtworkNotificationRuntime} from './server/customer-artwork/notification-runtime.ts';
import {logClientChainDiagnostic} from './server/client-chain-diagnostic.ts';

/** A private explicit notification deployment starts one bounded, unref'ed runner; pages never wait for delivery. */
export const onRequest=defineMiddleware(async(context,next)=>{
 logClientChainDiagnostic(context.request);
 if(process.env.INSIGNIA_CUSTOMER_EMAIL_ENABLED==='1'&&process.env.CUSTOMER_ARTWORK_EMAIL_PROFILE)void ensureCustomerArtworkNotificationRuntime();
 return next();
});
