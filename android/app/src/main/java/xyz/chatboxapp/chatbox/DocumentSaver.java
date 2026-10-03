package xyz.chatboxapp.chatbox;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Chatbox Mod —— DocumentSaver 原生插件
 *
 * 配合 src/renderer/platform/android_document_saver.ts 使用：
 * 接收 cache 里的临时文件 URI，通过系统「保存到」（ACTION_CREATE_DOCUMENT / SAF）
 * 让用户自选保存目录与文件名，随后把内容拷贝到目标位置。
 *
 * 用法：AndroidDocumentSaver.saveFile({ sourceUri, suggestedName, mimeType })
 * 返回 { uri }；用户取消时 reject "canceled"（renderer 侧按取消处理）。
 */
@CapacitorPlugin(name = "DocumentSaver")
public class DocumentSaver extends Plugin {

    private Uri pendingSource;

    @PluginMethod
    public void saveFile(PluginCall call) {
        String sourceUri = call.getString("sourceUri");
        String suggestedName = call.getString("suggestedName");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        if (sourceUri == null || sourceUri.isEmpty() || suggestedName == null || suggestedName.isEmpty()) {
            call.reject("sourceUri and suggestedName are required");
            return;
        }
        pendingSource = Uri.parse(sourceUri);

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, suggestedName);

        startActivityForResult(call, intent, "saveFileResult");
    }

    @ActivityCallback
    private void saveFileResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        try {
            Intent data = result.getData();
            if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
                call.reject("canceled");
                return;
            }
            Uri dst = data.getData();
            copyUri(pendingSource, dst);
            JSObject ret = new JSObject();
            ret.put("uri", dst.toString());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("copy failed: " + e.getMessage());
        } finally {
            pendingSource = null;
        }
    }

    private void copyUri(Uri src, Uri dst) throws IOException {
        Activity activity = getActivity();
        try (InputStream in = activity.getContentResolver().openInputStream(src);
             OutputStream out = activity.getContentResolver().openOutputStream(dst)) {
            if (in == null || out == null) {
                throw new IOException("cannot open content stream");
            }
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
            }
            out.flush();
        }
    }
}
