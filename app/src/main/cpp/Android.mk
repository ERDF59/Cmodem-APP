LOCAL_PATH := $(call my-dir)

include $(CLEAR_VARS)
LOCAL_MODULE := fhcpecore
LOCAL_SRC_FILES := native_core.cpp
LOCAL_CPPFLAGS := -std=c++17 -fvisibility=hidden -fexceptions -frtti -Wall -Wextra -Werror
LOCAL_LDFLAGS := -Wl,--gc-sections
include $(BUILD_SHARED_LIBRARY)
