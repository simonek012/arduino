package sk.riskuj.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** Riskuj ako aplikácia: otvorí hru z webu (vždy najnovšia verzia), bez signálu z pamäte. */
public class MainActivity extends Activity {
    private WebView web;
    private PermissionRequest cakajuca;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);   // displej počas hry nezhasne
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(5, 9, 32));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if ("simonek012.github.io".equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { }
                return true;   // WhatsApp, YouTube… otvorí v iných aplikáciách
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                // bez internetu: hra z pamäte (raz musí byť otvorená s internetom)
                if (r.isForMainFrame() && v.getSettings().getCacheMode() != WebSettings.LOAD_CACHE_ELSE_NETWORK) {
                    v.getSettings().setCacheMode(WebSettings.LOAD_CACHE_ELSE_NETWORK);
                    v.loadUrl(r.getUrl().toString());
                }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest r) {   // kamera na QR kódy
                if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) r.grant(r.getResources());
                else { cakajuca = r; requestPermissions(new String[]{Manifest.permission.CAMERA}, 1); }
            }
        });
        setContentView(web);
        if (saved == null || web.restoreState(saved) == null) web.loadUrl(getString(getResources().getIdentifier("web_url", "string", getPackageName())));
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] p, int[] g) {
        if (cakajuca == null) return;
        if (g.length > 0 && g[0] == PackageManager.PERMISSION_GRANTED) cakajuca.grant(cakajuca.getResources());
        else cakajuca.deny();
        cakajuca = null;
    }

    @Override
    protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

    @Override
    public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }
}
