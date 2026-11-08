package com.community.nothing5.launcher

import android.app.WallpaperManager
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Drawable
import android.os.BatteryManager
import android.os.Bundle
import android.provider.CalendarContract
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
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Apps
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.Wallpaper
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
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
private val FOLDERS = listOf("All", "Social", "Work", "Media", "Tools")

data class LaunchableApp(val label: String, val packageName: String, val icon: Drawable)

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
            primary = Accent, onPrimary = Color.White, background = Void,
            onBackground = Paper, surface = Panel, onSurface = Paper,
            surfaceVariant = Color(0xFF262626), onSurfaceVariant = Dim
        ), content = content
    )
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun LauncherHome() {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("nothing_launcher", Context.MODE_PRIVATE) }
    var apps by remember { mutableStateOf(loadLaunchableApps(context)) }
    var drawer by remember { mutableStateOf(false) }
    var search by remember { mutableStateOf("") }
    var folder by remember { mutableStateOf("All") }
    var selected by remember { mutableStateOf<LaunchableApp?>(null) }
    var now by remember { mutableStateOf(Date()) }
    var battery by remember { mutableIntStateOf(readBattery(context)) }
    var favorites by remember { mutableStateOf<Set<String>>(prefs.getStringSet("favorites", emptySet<String>())?.toSet() ?: emptySet()) }
    var appFolders by remember { mutableStateOf<Map<String, String>>(prefs.getStringSet("app_folders", emptySet<String>())?.mapNotNull { entry ->
        val parts = entry.split("|", limit = 2)
        if (parts.isNotEmpty()) parts[0] to parts.getOrElse(1) { "Tools" } else null
    }?.toMap() ?: emptyMap()) }
    var use24Hour by remember { mutableStateOf(prefs.getBoolean("clock24", true)) }
    var options by remember { mutableStateOf(false) }
    var folderPicker by remember { mutableStateOf<LaunchableApp?>(null) }
    var widgetPanel by remember { mutableStateOf(false) }

    fun saveFavorites(next: Set<String>) {
        favorites = next
        prefs.edit().putStringSet("favorites", next).apply()
    }
    fun saveFolders(next: Map<String, String>) {
        appFolders = next
        prefs.edit().putStringSet("app_folders", next.map { "${it.key}|${it.value}" }.toSet()).apply()
    }

    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        apps = loadLaunchableApps(context)
        battery = readBattery(context)
    }
    LaunchedEffect(Unit) {
        while (true) { now = Date(); battery = readBattery(context); delay(30_000) }
    }

    val visible = remember(apps, search, drawer, folder, appFolders) {
        val base = if (drawer || search.isNotBlank()) apps else apps.filter { it.packageName in favorites }
        val grouped = if (folder == "All") base else base.filter { appFolders[it.packageName] == folder }
        if (search.isBlank()) grouped else apps.filter { it.label.contains(search, true) }
    }

    Box(
        Modifier.fillMaxSize().background(Void).statusBarsPadding().navigationBarsPadding()
            .pointerInput(drawer) {
                var total = 0f
                detectVerticalDragGestures(
                    onVerticalDrag = { _, amount -> total += amount },
                    onDragEnd = { if (total < -55f) { drawer = true; widgetPanel = false } else if (total > 55f) { drawer = false; widgetPanel = false }; total = 0f }
                )
            }
    ) {
        Column(Modifier.fillMaxSize().padding(horizontal = 22.dp, vertical = 12.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f)) {
                    Text(SimpleDateFormat("EEEE  ·  d MMMM", Locale.getDefault()).format(now).uppercase(Locale.getDefault()),
                        color = Dim, fontSize = 10.sp, letterSpacing = 1.8.sp)
                    Spacer(Modifier.height(8.dp))
                    Text(SimpleDateFormat(if (use24Hour) "HH:mm" else "h:mm", Locale.getDefault()).format(now),
                        color = Paper, fontSize = 58.sp, fontWeight = FontWeight.Light,
                        letterSpacing = (-2).sp, lineHeight = 60.sp)
                    Text("MICROGRAPHICS  /  ${battery.takeIf { it >= 0 }?.let { "$it% BATTERY" } ?: "CMF PHONE"}",
                        color = Dim, fontSize = 9.sp, letterSpacing = 1.7.sp)
                }
                IconButton(onClick = { options = true }) {
                    Icon(Icons.Rounded.Settings, contentDescription = "Launcher settings", tint = Paper)
                }
            }

            Spacer(Modifier.height(20.dp))
            SearchBar(value = search, onChange = { search = it; if (it.isNotBlank()) drawer = true })
            Spacer(Modifier.height(20.dp))

            if (widgetPanel) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        SectionLabel("YOUR WIDGETS")
                        Text("At a glance", color = Paper, fontSize = 20.sp, fontWeight = FontWeight.Medium)
                    }
                    TextButton(onClick = { widgetPanel = false }) { Text("DONE", color = Accent) }
                }
                Spacer(Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    WidgetCard("TIME", SimpleDateFormat("HH:mm", Locale.getDefault()).format(now), "Live clock", Modifier.weight(1f))
                    WidgetCard("BATTERY", if (battery >= 0) "$battery%" else "—", "Device power", Modifier.weight(1f))
                }
                Spacer(Modifier.height(10.dp))
                Surface(color = Panel, shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth().clickable {
                    try { context.startActivity(Intent(Intent.ACTION_VIEW).setData(CalendarContract.CONTENT_URI)) } catch (_: Exception) {}
                }) {
                    Row(Modifier.padding(17.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Rounded.CalendarMonth, null, tint = Accent)
                        Spacer(Modifier.width(12.dp))
                        Column { Text("CALENDAR", color = Dim, fontSize = 9.sp, letterSpacing = 1.5.sp); Text("Open your calendar", color = Paper, fontSize = 14.sp) }
                    }
                }
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        SectionLabel(if (drawer) "APPLICATION INDEX" else "YOUR SPACE")
                        Text(if (drawer) "All applications." else "Make room for what matters.",
                            color = Paper, fontSize = 19.sp, fontWeight = FontWeight.Medium)
                    }
                    IconButton(onClick = { drawer = !drawer; search = ""; folder = "All" }) {
                        Icon(Icons.Rounded.Apps, contentDescription = "Toggle app drawer", tint = Paper)
                    }
                    IconButton(onClick = { widgetPanel = true }) {
                        Text("▦", color = Paper, fontSize = 25.sp)
                    }
                }
                if (drawer) {
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                        FOLDERS.forEach { item ->
                            FilterChip(selected = folder == item, onClick = { folder = item },
                                label = { Text(item, fontSize = 10.sp) },
                                colors = FilterChipDefaults.filterChipColors(selectedContainerColor = Accent, selectedLabelColor = Color.White))
                        }
                    }
                }
                Spacer(Modifier.height(14.dp))
                AnimatedContent(targetState = drawer, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "launcher-grid") { isDrawer ->
                    if (visible.isEmpty()) {
                        Box(Modifier.fillMaxWidth().height(190.dp), contentAlignment = Alignment.Center) {
                            Text(if (apps.isEmpty()) "No launchable apps found" else if (!isDrawer) "Pin apps from the app drawer" else "No applications here", color = Dim, fontSize = 13.sp)
                        }
                    } else {
                        LazyVerticalGrid(columns = GridCells.Fixed(4),
                            modifier = Modifier.fillMaxWidth().heightIn(max = if (isDrawer) 500.dp else 240.dp),
                            contentPadding = PaddingValues(bottom = 14.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalArrangement = Arrangement.spacedBy(17.dp)) {
                            items(visible, key = { it.packageName }) { app ->
                                AppTile(app, app.packageName in favorites,
                                    onClick = { launchApp(context, app) },
                                    onLongPress = { selected = app })
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.weight(1f))
            if (!drawer && !widgetPanel && search.isBlank()) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("FAVOURITES  /  QUICK ACCESS", color = Dim, fontSize = 9.sp, letterSpacing = 1.6.sp, modifier = Modifier.weight(1f))
                    TextButton(onClick = { drawer = true }) { Text("EDIT", color = Accent, fontSize = 10.sp) }
                }
                Surface(color = Panel, shape = RoundedCornerShape(23.dp)) {
                    Row(Modifier.fillMaxWidth().height(76.dp).padding(horizontal = 12.dp),
                        horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
                        val pinned = apps.filter { it.packageName in favorites }.take(5)
                        pinned.forEach { app ->
                            AndroidView(factory = { ImageView(it).apply { scaleType = ImageView.ScaleType.FIT_CENTER } },
                                update = { it.setImageDrawable(app.icon) },
                                modifier = Modifier.size(42.dp).clickable { launchApp(context, app) })
                        }
                        if (pinned.isEmpty()) Text("Hold an app in the drawer to pin it here", color = Dim, fontSize = 10.sp)
                    }
                }
            }
            Spacer(Modifier.height(10.dp))
            Text("NOTHING 5  /  COMMUNITY EDITION", color = Dim, fontSize = 9.sp, letterSpacing = 1.7.sp,
                modifier = Modifier.align(Alignment.CenterHorizontally).padding(bottom = 5.dp))
        }
    }

    if (options) {
        AlertDialog(onDismissRequest = { options = false }, containerColor = Panel,
            title = { Text("Launcher settings", color = Paper) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) { Text("24-hour clock", color = Paper); Text("Switch between 24h and 12h", color = Dim, fontSize = 11.sp) }
                        Switch(checked = use24Hour, onCheckedChange = { use24Hour = it; prefs.edit().putBoolean("clock24", it).apply() })
                    }
                    HorizontalDivider(color = Color.DarkGray)
                    Row(Modifier.fillMaxWidth().clickable {
                        options = false
                        try { context.startActivity(Intent(WallpaperManager.ACTION_LIVE_WALLPAPER_CHOOSER)) }
                        catch (_: Exception) { try { context.startActivity(Intent(Intent.ACTION_SET_WALLPAPER)) } catch (_: Exception) {} }
                    }, verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Rounded.Wallpaper, null, tint = Accent)
                        Spacer(Modifier.width(12.dp)); Text("Choose wallpaper", color = Paper)
                    }
                    Row(Modifier.fillMaxWidth().clickable {
                        options = false
                        context.startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    }, verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Rounded.Settings, null, tint = Accent)
                        Spacer(Modifier.width(12.dp)); Text("System settings", color = Paper)
                    }
                }
            },
            confirmButton = { TextButton(onClick = { options = false }) { Text("CLOSE", color = Accent) } })
    }

    selected?.let { app ->
        AlertDialog(onDismissRequest = { selected = null }, containerColor = Panel,
            title = { Text(app.label, color = Paper) },
            text = { Text("Choose what to do with this app.", color = Dim) },
            confirmButton = {
                TextButton(onClick = {
                    val next = favorites.toMutableSet()
                    if (app.packageName in next) next.remove(app.packageName) else next.add(app.packageName)
                    saveFavorites(next); selected = null
                }) { Text(if (app.packageName in favorites) "UNPIN FAVOURITE" else "PIN FAVOURITE", color = Accent) }
            },
            dismissButton = {
                Row {
                    TextButton(onClick = { folderPicker = app; selected = null }) { Text("FOLDER", color = Paper) }
                    TextButton(onClick = {
                        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply { data = android.net.Uri.parse("package:${app.packageName}") }
                        context.startActivity(intent); selected = null
                    }) { Text("APP INFO", color = Paper) }
                }
            })
    }
    folderPicker?.let { app ->
        AlertDialog(onDismissRequest = { folderPicker = null }, containerColor = Panel,
            title = { Text("Move to folder", color = Paper) },
            text = { Column { FOLDERS.drop(1).forEach { name ->
                TextButton(onClick = { saveFolders(appFolders + (app.packageName to name)); folderPicker = null }) {
                    Text(name.uppercase(), color = if (appFolders[app.packageName] == name) Accent else Paper)
                }
            }; TextButton(onClick = { saveFolders(appFolders - app.packageName); folderPicker = null }) { Text("REMOVE FROM FOLDER", color = Dim) } } },
            confirmButton = { TextButton(onClick = { folderPicker = null }) { Text("CLOSE", color = Accent) } })
    }
}

@Composable
private fun SectionLabel(value: String) {
    Text(value, color = Dim, fontSize = 10.sp, letterSpacing = 2.sp, fontWeight = FontWeight.SemiBold)
    Spacer(Modifier.height(4.dp))
}

@Composable
private fun WidgetCard(label: String, value: String, caption: String, modifier: Modifier = Modifier) {
    Surface(color = Panel, shape = RoundedCornerShape(19.dp), modifier = modifier.height(118.dp)) {
        Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.SpaceBetween) {
            Text(label, color = Dim, fontSize = 9.sp, letterSpacing = 1.5.sp)
            Text(value, color = Paper, fontSize = 32.sp, fontWeight = FontWeight.Light)
            Text(caption, color = Dim, fontSize = 10.sp)
        }
    }
}

@Composable
private fun SearchBar(value: String, onChange: (String) -> Unit) {
    Surface(color = Panel, shape = RoundedCornerShape(17.dp)) {
        Row(Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 15.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.Search, contentDescription = null, tint = Dim, modifier = Modifier.size(19.dp))
            Spacer(Modifier.width(11.dp))
            BasicTextField(value = value, onValueChange = onChange, singleLine = true,
                textStyle = TextStyle(color = Paper, fontSize = 14.sp), modifier = Modifier.weight(1f),
                decorationBox = { inner -> Box { if (value.isEmpty()) Text("Search applications", color = Dim, fontSize = 14.sp); inner() } })
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun AppTile(app: LaunchableApp, favorite: Boolean, onClick: () -> Unit, onLongPress: () -> Unit) {
    Column(Modifier.fillMaxWidth().combinedClickable(onClick = onClick, onLongClick = onLongPress),
        horizontalAlignment = Alignment.CenterHorizontally) {
        Box {
            Surface(color = Panel, shape = RoundedCornerShape(19.dp), modifier = Modifier.size(61.dp)) {
                AndroidView(factory = { ImageView(it).apply { scaleType = ImageView.ScaleType.FIT_CENTER } },
                    update = { it.setImageDrawable(app.icon) }, modifier = Modifier.padding(10.dp))
            }
            if (favorite) Box(Modifier.align(Alignment.TopEnd).size(9.dp).background(Accent, RoundedCornerShape(50)))
        }
        Spacer(Modifier.height(7.dp))
        Text(app.label, color = Paper, fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

private fun loadLaunchableApps(context: Context): List<LaunchableApp> = try {
    val pm = context.packageManager
    val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    @Suppress("DEPRECATION")
    pm.queryIntentActivities(intent, 0).mapNotNull { info ->
        val activity = info.activityInfo ?: return@mapNotNull null
        if (activity.packageName == context.packageName) return@mapNotNull null
        LaunchableApp(info.loadLabel(pm).toString(), activity.packageName, info.loadIcon(pm))
    }.distinctBy { it.packageName }.sortedBy { it.label.lowercase(Locale.getDefault()) }
} catch (_: Exception) { emptyList() }

private fun readBattery(context: Context): Int =
    context.getSystemService(BatteryManager::class.java)?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: -1

private fun launchApp(context: Context, app: LaunchableApp) {
    val launchIntent = context.packageManager.getLaunchIntentForPackage(app.packageName) ?: return
    context.startActivity(launchIntent)
}
