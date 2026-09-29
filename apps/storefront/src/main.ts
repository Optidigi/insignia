import './element';

const controls = document.querySelector('#controls');
controls?.querySelector('#mount')?.addEventListener('click', () => {
  document.querySelector('#preview-slot')?.append(document.createElement('insignia-local-preview'));
});
controls?.querySelector('#unmount')?.addEventListener('click', () => {
  document.querySelector('#preview-slot insignia-local-preview')?.remove();
});
