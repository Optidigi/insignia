import { render } from 'preact';
import ArtworkUpload from '../../src/islands/ArtworkUpload';

render(
  <ArtworkUpload
    api={window.artworkApi}
    onPreview={(preview) => window.previews.push(preview)}
    onAssetChange={(asset) => window.assets.push(asset)}
  />,
  document.body,
);
