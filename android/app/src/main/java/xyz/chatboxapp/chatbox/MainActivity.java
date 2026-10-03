package xyz.chatboxapp.chatbox;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // 必须在 super.onCreate() 之前注册：BridgeActivity.onCreate 内部会 load() 创建 Bridge
    // （插件列表随即冻结），之后再 registerPlugin 只会写入无效的 builder，运行时仍报 not implemented
    registerPlugin(DocumentSaver.class);
    super.onCreate(savedInstanceState);
  }
}
