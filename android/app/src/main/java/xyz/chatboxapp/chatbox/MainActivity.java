package xyz.chatboxapp.chatbox;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    // 本地原生插件（不在 node_modules，cap sync 不会自动注册）需手动注册
    registerPlugin(DocumentSaver.class);
  }
}
