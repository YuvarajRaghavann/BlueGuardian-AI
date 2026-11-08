package com.community.nothing5.launcher

import android.content.Context
import android.content.Intent
import android.graphics.drawable.Drawable
import android.os.BatteryManager
import android.os.Bundle
import android.provider.Settings
import android.widget.ImageView
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Apps
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val Void = Color(0xFF080808)
private val Paper = Color(0xFFF4F4EF)
private val Dim = Color(0xFF969690)
private val Accent = Color(0xFFE43D36)
private val Panel = Color(0xFF191919)

data class LaunchableApp(
    val label: String,
    val packageName: String,
    val icon: Drawable
)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { NothingLauncherTheme { LauncherHome() } }
    }
}

@Composable
private fun NothingLauncherTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Accent,
            onPrimary = Color.White,
            background = Void,
            onBackground = Paper,
            surface = Panel,
            onSurface = Paper,
            surfaceVariant = Color(0xFF262626),
            onSurfaceVariant = Dim
        ),
        content = content
    )
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun LauncherHome() {
    val context = LocalContext.current
    var apps by remember { mutableStateOf(loadLaunchableApps(context)) }
    var drawer by remember { mutableStateOf(false) }
    var search by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf<LaunchableApp?>(null) }
    var now by remember { mutableStateOf(Date()) }
    var battery by remember { mutableIntStateOf(readBattery(context)) }

    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        apps = loadLaunchableApps(context)
        battery = readBattery(context)
    }
    LaunchedEffect(Unit) {
        while (true) {
            now = Date()
            battery = readBattery(context)
            delay(30_000)
        }
    }

    val visible = remember(apps, search, drawer) {
        val source = if (drawer || search.isNotBlank()) apps else apps.take(8)
        if (search.isBlank()) source else apps.filter { it.label.contains(search, true) }
    }

    Box(
        Modifier.fillMaxSize().background(Void)
            .statusBarsPadding().navigationBarsPadding()
    ) {
        Column(Modifier.fillMaxSize().padding(horizontal = 22.dp, vertical = 12.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f)) {
                    Text(
                        SimpleDateFormat("EEEE  ·  d MMMM", Locale.getDefault())
                            .format(now).uppercase(Locale.getDefault()),
                        color = Dim, fontSize = 10.sp, letterSpacing = 1.8.sp
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        SimpleDateFormat("HH:mm", Locale.getDefault()).format(now),
                        color = Paper, fontSize = 54.sp, fontWeight = FontWeight.Light,
                        letterSpacing = (-2).sp, lineHeight = 56.sp
                    )
                    Text(
                        "MICROGRAPHICS  /  ${battery.takeIf { it >= 0 }?.let { "$it% BATTERY" } ?: "CMF PHONE"}",
                        color = Dim, fontSize = 9.sp, letterSpacing = 1.7.sp
                    )
                }
                IconButton(onClick = {
                    context.startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }) {
                    Icon(Icons.Rounded.Settings, contentDescription = "System settings", tint = Paper)
                }
            }

            Spacer(Modifier.height(22.dp))
            SearchBar(value = search, onChange = { search = it })
            Spacer(Modifier.height(22.dp))

            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        if (drawer) "APPLICATION INDEX" else "YOUR SPACE",
                        color = Dim, fontSize = 10.sp, letterSpacing = 2.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        if (drawer) "All applications." else "Make room for what matters.",
                        color = Paper, fontSize = 19.sp, fontWeight = FontWeight.Medium
                    )
                }
                IconButton(onClick = { drawer = !drawer; search = "" }) {
                    Icon(Icons.Rounded.Apps, contentDescription = "Toggle app drawer", tint = Paper)
                }
            }
            Spacer(Modifier.height(16.dp))

            AnimatedContent(
                targetState = drawer,
                transitionSpec = { fadeIn() togetherWith fadeOut() },
                label = "launcher-grid"
            ) { isDrawer ->
                if (visible.isEmpty()) {
                    Box(Modifier.fillMaxWidth().height(220.dp), contentAlignment = Alignment.Center) {
                        Text(if (apps.isEmpty()) "No launchable apps found" else "No matches", color = Dim, fontSize = 13.sp)
                    }
                } else {
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(4),
                        modifier = Modifier.fillMaxWidth().heightIn(max = if (isDrawer) 560.dp else 250.dp),
                        contentPadding = PaddingValues(bottom = 16.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(18.dp)
                    ) {
                        items(visible, key = { it.packageName }) { app ->
                            AppTile(app = app, onClick = { launchApp(context, app) }, onLongPress = { selected = app })
                        }
                    }
                }
            }

            Spacer(Modifier.weight(1f))
            if (!drawer && search.isBlank()) {
                Text(
                    "FAVOURITES  /  QUICK ACCESS", color = Dim, fontSize = 9.sp,
                    letterSpacing = 1.6.sp, modifier = Modifier.padding(bottom = 9.dp)
                )
                Surface(color = Panel, shape = RoundedCornerShape(23.dp)) {
                    Row(
                        Modifier.fillMaxWidth().height(76.dp).padding(horizontal = 12.dp),
                        horizontalArrangement = Arrangement.SpaceEvenly,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        apps.take(4).forEach { app ->
                            AndroidView(
                                factory = { ImageView(it).apply { scaleType = ImageView.ScaleType.FIT_CENTER } },
                                update = { it.setImageDrawable(app.icon) },
                                modifier = Modifier.size(44.dp).clickable { launchApp(context, app) }
                            )
                        }
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
            Text(
                "NOTHING 5  /  COMMUNITY EDITION",
                color = Dim, fontSize = 9.sp, letterSpacing = 1.7.sp,
                modifier = Modifier.align(Alignment.CenterHorizontally).padding(bottom = 6.dp)
            )
        }
    }

    selected?.let { app ->
        AlertDialog(
            onDismissRequest = { selected = null },
            containerColor = Color(0xFF202020),
            title = { Text(app.label, color = Paper) },
            text = { Text("Application options", color = Dim) },
            confirmButton = {
                TextButton(onClick = {
                    val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                        data = android.net.Uri.parse("package:${app.packageName}")
                    }
                    context.startActivity(intent)
                    selected = null
                }) { Text("APP INFO", color = Accent) }
            },
            dismissButton = {
                TextButton(onClick = { selected = null }) { Text("CLOSE", color = Paper) }
            }
        )
    }
}

@Composable
private fun SearchBar(value: String, onChange: (String) -> Unit) {
    Surface(color = Panel, shape = RoundedCornerShape(17.dp)) {
        Row(
            Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 15.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(Icons.Rounded.Search, contentDescription = null, tint = Dim, modifier = Modifier.size(19.dp))
            Spacer(Modifier.width(11.dp))
            BasicTextField(
                value = value,
                onValueChange = onChange,
                singleLine = true,
                textStyle = TextStyle(color = Paper, fontSize = 14.sp),
                modifier = Modifier.weight(1f),
                decorationBox = { inner ->
                    Box {
                        if (value.isEmpty()) Text("Search applications", color = Dim, fontSize = 14.sp)
                        inner()
                    }
                }
            )
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun AppTile(app: LaunchableApp, onClick: () -> Unit, onLongPress: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().combinedClickable(onClick = onClick, onLongClick = onLongPress),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Surface(color = Panel, shape = RoundedCornerShape(19.dp), modifier = Modifier.size(61.dp)) {
            AndroidView(
                factory = { ImageView(it).apply { scaleType = ImageView.ScaleType.FIT_CENTER } },
                update = { it.setImageDrawable(app.icon) },
                modifier = Modifier.padding(10.dp)
            )
        }
        Spacer(Modifier.height(7.dp))
        Text(app.label, color = Paper, fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

private fun loadLaunchableApps(context: Context): List<LaunchableApp> = try {
    val pm = context.packageManager
    val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    @Suppress("DEPRECATION")
    pm.queryIntentActivities(intent, 0)
        .mapNotNull { info ->
            val activity = info.activityInfo ?: return@mapNotNull null
            if (activity.packageName == context.packageName) return@mapNotNull null
            LaunchableApp(
                label = info.loadLabel(pm).toString(),
                packageName = activity.packageName,
                icon = info.loadIcon(pm)
            )
        }
        .distinctBy { it.packageName }
        .sortedBy { it.label.lowercase(Locale.getDefault()) }
} catch (_: Exception) {
    emptyList()
}

private fun readBattery(context: Context): Int =
    context.getSystemService(BatteryManager::class.java)
        ?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: -1

private fun launchApp(context: Context, app: LaunchableApp) {
    val launchIntent = context.packageManager.getLaunchIntentForPackage(app.packageName) ?: return
    context.startActivity(launchIntent)
}
