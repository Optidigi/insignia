// CUSTOM official session seeding. No lazy default-auth initialization is allowed.
export async function existingClient({authenticate,getClient}){
 const result=await authenticate({noPrompt:true});
 if(!result || typeof result.appManagementToken!=='string'||!result.appManagementToken || typeof result.businessPlatformToken!=='string'||!result.businessPlatformToken || typeof result.userId!=='string'||!result.userId)throw Error('OFFICIAL_AUTH_RESULT_INVALID');
 // Tokens and user ID come solely from the official noPrompt result, never raw cache.
 // Account information is deliberately unobserved; this is an internal SDK sentinel.
 const session={token:result.appManagementToken,businessPlatformToken:result.businessPlatformToken,userId:result.userId,accountInfo:{type:'UnknownAccount'}};
 const Constructor=getClient().constructor;
 if(typeof Constructor.getInstance!=='function'||typeof Constructor.resetInstance!=='function')throw Error('OFFICIAL_CLIENT_CONSTRUCTOR_INVALID');
 Constructor.resetInstance();
 const client=Constructor.getInstance(session);
 if(getClient()!==client)throw Error('OFFICIAL_GETTER_BINDING_INVALID');
 return client;
}
