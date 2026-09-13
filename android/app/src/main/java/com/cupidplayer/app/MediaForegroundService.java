package com.cupidplayer.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;

/**
 * Dependency-free foreground service that keeps Chromium's audio decoder
 * alive while the app is backgrounded. On Android 14+ (API 34+), a
 * mediaPlayback foreground service MUST pass
 * ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK to startForeground(),
 * or the OS silently refuses to let the service run as a real foreground
 * service. That flag is the whole reason Attempts 1 and 2 failed.
 */
public class MediaForegroundService extends Service {

    public static final String ACTION_UPDATE_METADATA = "com.cupidplayer.app.UPDATE_METADATA";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_ARTIST = "artist";

    private static final String CHANNEL_ID = "cupid_player_playback_channel";
    private static final int NOTIFICATION_ID = 1;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String title = "Cupid Player";
        String artist = "Playing";

        if (intent != null) {
            title = intent.getStringExtra(EXTRA_TITLE) != null ? intent.getStringExtra(EXTRA_TITLE) : title;
            artist = intent.getStringExtra(EXTRA_ARTIST) != null ? intent.getStringExtra(EXTRA_ARTIST) : artist;
        }

        Notification notification = buildNotification(title, artist);

        if (Build.VERSION.SDK_INT >= 34 /* Build.VERSION_CODES.UPSIDE_DOWN_CAKE */) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        return START_STICKY;
    }

    /**
     * Re-issuing a notification with the same NOTIFICATION_ID replaces the
     * currently showing foreground notification's content in place — this
     * works from anywhere in the app process, so track-change updates don't
     * need a live binder connection back to the running service instance.
     */
    public static void updateNotification(android.content.Context context, String title, String artist) {
        Notification notification = buildStaticNotification(context, title, artist);
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, notification);
        }
    }

    private Notification buildNotification(String title, String artist) {
        return buildStaticNotification(this, title, artist);
    }

    private static Notification buildStaticNotification(android.content.Context context, String title, String artist) {
        Intent activityIntent = new Intent(context, MainActivity.class);
        PendingIntent contentIntent = PendingIntent.getActivity(
            context, 0, activityIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(artist)
            .setSmallIcon(android.R.drawable.ic_media_play) // swap for a real notification icon later
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Playback",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Cupid Player background playback");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}