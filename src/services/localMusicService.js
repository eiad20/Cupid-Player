import { FilePicker } from '@capawesome/capacitor-file-picker';
import { Capacitor } from '@capacitor/core';
import * as musicMetadata from 'music-metadata-browser';

export async function pickAndScanDeviceAudio() {
  const result = await FilePicker.pickFiles({
    types: ['audio/*'],
    multiple: true,
    readData: true,
  });

  const parsedTracks = [];

  for (const file of result.files) {
    const webPath = Capacitor.convertFileSrc(file.path);
    let title = file.name.replace(/\.[^/.]+$/, '');
    let artist = 'Local Storage';
    let duration = 0;
    let art = null;

    if (file.data) {
      try {
        const byteCharacters = atob(file.data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const metadata = await musicMetadata.parseBuffer(byteArray, file.mimeType);

        if (metadata.common.title) title = metadata.common.title;
        if (metadata.common.artist) artist = metadata.common.artist;
        if (metadata.format.duration) duration = metadata.format.duration;

        if (metadata.common.picture && metadata.common.picture.length > 0) {
          const pic = metadata.common.picture[0];
          const base64Pic = btoa(String.fromCharCode(...pic.data));
          art = `data:${pic.format};base64,${base64Pic}`;
        }
      } catch (err) {
        console.warn('Could not parse metadata for:', file.name, err);
      }
    }

    parsedTracks.push({
      file: webPath,
      title,
      artist,
      duration,
      art,
      isLocalDevice: true,
    });
  }

  return parsedTracks;
}