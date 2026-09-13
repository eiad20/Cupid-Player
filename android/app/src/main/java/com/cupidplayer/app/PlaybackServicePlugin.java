package com.cupidplayer.app;

import android.content.Intent;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS-callable control surface for MediaForegroundService.
 * Usage from JS:
 *   import { registerPlugin } from '@capacitor/core';
 *   const PlaybackService = registerPlugin('PlaybackService');
 *   PlaybackService.start({ title, artist });     // call when playback starts
 *   PlaybackService.updateMetadata({ title, artist }); // call on track change
 *   PlaybackService.stop();                       // call when playback fully stops
 */
@CapacitorPlugin(name = "PlaybackService")
public class PlaybackServicePlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        String title = call.getString("title", "Cupid Player");
        String artist = call.getString("artist", "Playing");

        Intent intent = new Intent(getContext(), MediaForegroundService.class);
        intent.putExtra(MediaForegroundService.EXTRA_TITLE, title);
        intent.putExtra(MediaForegroundService.EXTRA_ARTIST, artist);
        ContextCompat.startForegroundService(getContext(), intent);

        call.resolve();
    }

    @PluginMethod
    public void updateMetadata(PluginCall call) {
        String title = call.getString("title", "Cupid Player");
        String artist = call.getString("artist", "Playing");
        MediaForegroundService.updateNotification(getContext(), title, artist);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), MediaForegroundService.class);
        getContext().stopService(intent);
        call.resolve();
    }
}
