/** Executes built Astro output; this mode never grants production artifact or publication authority. */
export function prepareBuiltPreviewRuntime(env) {
  // CLI dev supplies NODE_ENV=development, which otherwise changes Astro's inline hydration script.
  env.NODE_ENV = 'production';
}
