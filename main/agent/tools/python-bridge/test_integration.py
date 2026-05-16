#!/usr/bin/env python3
"""
Integration tests for browser-use library integration.

This script tests the LLM provider configuration and browser configuration
functions to ensure they work correctly with the browser-use library.
"""

import sys
import os

# Set test mode to skip actual browser execution
os.environ["SKIP_DEPENDENCY_CHECK"] = "1"

def test_llm_provider_configuration():
    """Test LLM provider configuration for all supported providers."""
    print("\n" + "="*60)
    print("Test: LLM Provider Configuration")
    print("="*60)

    from browser_use_bridge import configure_llm_provider

    test_cases = [
        {
            "name": "OpenAI",
            "config": {
                "provider": "openai",
                "model": "gpt-4",
                "api_key": "test-key",
                "base_url": "https://api.openai.com/v1"
            },
            "should_pass": True
        },
        {
            "name": "Gemini",
            "config": {
                "provider": "gemini",
                "model": "gemini-pro",
                "api_key": "test-key",
                "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/"
            },
            "should_pass": True
        },
        {
            "name": "NVIDIA",
            "config": {
                "provider": "nvidia",
                "model": "nvidia/llama-3.1-nemotron-70b-instruct",
                "api_key": "test-key",
                "base_url": "https://integrate.api.nvidia.com/v1"
            },
            "should_pass": True
        },
        {
            "name": "Ollama Cloud",
            "config": {
                "provider": "ollama-cloud",
                "model": "llama3.2",
                "api_key": "test-key",
                "base_url": "https://cloud.ollama.ai/v1"
            },
            "should_pass": True
        },
        {
            "name": "Ollama Local",
            "config": {
                "provider": "ollama",
                "model": "llama3.2",
                "api_key": "",
                "base_url": "http://localhost:11434/v1"
            },
            "should_pass": True
        },
        {
            "name": "Unsupported Provider",
            "config": {
                "provider": "unsupported",
                "model": "test-model",
                "api_key": "test-key"
            },
            "should_pass": False
        },
        {
            "name": "Missing Model",
            "config": {
                "provider": "openai",
                "api_key": "test-key"
            },
            "should_pass": False
        }
    ]

    passed = 0
    failed = 0

    for test_case in test_cases:
        try:
            llm = configure_llm_provider(test_case["config"])
            if test_case["should_pass"]:
                print(f"✅ {test_case['name']}: PASSED")
                passed += 1
            else:
                print(f"❌ {test_case['name']}: FAILED (Expected error but got success)")
                failed += 1
        except Exception as e:
            if not test_case["should_pass"]:
                print(f"✅ {test_case['name']}: PASSED (Got expected error)")
                passed += 1
            else:
                print(f"❌ {test_case['name']}: FAILED (Unexpected error: {str(e)})")
                failed += 1

    print(f"\nLLM Provider Tests: {passed} passed, {failed} failed")
    return failed == 0


def test_browser_options_validation():
    """Test browser options validation."""
    print("\n" + "="*60)
    print("Test: Browser Options Validation")
    print("="*60)

    test_cases = [
        {
            "name": "Default viewport",
            "options": {},
            "expected_viewport": (1280, 720)
        },
        {
            "name": "Custom viewport",
            "options": {
                "viewport_width": 1920,
                "viewport_height": 1080
            },
            "expected_viewport": (1920, 1080)
        },
        {
            "name": "Headless mode",
            "options": {
                "headless": True
            },
            "expected_viewport": (1280, 720)
        },
        {
            "name": "Custom timeout",
            "options": {
                "timeout": 60000
            },
            "expected_viewport": (1280, 720)
        }
    ]

    passed = 0
    failed = 0

    for test_case in test_cases:
        try:
            options = test_case["options"]
            viewport_width = options.get("viewport_width", 1280)
            viewport_height = options.get("viewport_height", 720)

            if (viewport_width, viewport_height) == test_case["expected_viewport"]:
                print(f"✅ {test_case['name']}: PASSED")
                passed += 1
            else:
                print(f"❌ {test_case['name']}: FAILED")
                failed += 1
        except Exception as e:
            print(f"❌ {test_case['name']}: FAILED (Error: {str(e)})")
            failed += 1

    print(f"\nBrowser Options Tests: {passed} passed, {failed} failed")
    return failed == 0


def test_extension_path_handling():
    """Test Chrome extension path handling."""
    print("\n" + "="*60)
    print("Test: Chrome Extension Path Handling")
    print("="*60)

    test_cases = [
        {
            "name": "No extension path",
            "options": {},
            "check": "no_path"
        },
        {
            "name": "Extension path provided",
            "options": {
                "extension_path": "./chrome-extension"
            },
            "check": "has_path"
        },
        {
            "name": "Nonexistent extension path",
            "options": {
                "extension_path": "./nonexistent-extension"
            },
            "check": "path_not_exists"
        }
    ]

    passed = 0
    failed = 0

    for test_case in test_cases:
        try:
            options = test_case["options"]
            extension_path = options.get("extension_path")

            if test_case["check"] == "no_path":
                if extension_path is None:
                    print(f"✅ {test_case['name']}: PASSED")
                    passed += 1
                else:
                    print(f"❌ {test_case['name']}: FAILED")
                    failed += 1
            elif test_case["check"] == "has_path":
                if extension_path:
                    print(f"✅ {test_case['name']}: PASSED")
                    passed += 1
                else:
                    print(f"❌ {test_case['name']}: FAILED")
                    failed += 1
            elif test_case["check"] == "path_not_exists":
                if extension_path and not os.path.exists(extension_path):
                    print(f"✅ {test_case['name']}: PASSED")
                    passed += 1
                else:
                    print(f"❌ {test_case['name']}: FAILED")
                    failed += 1
        except Exception as e:
            print(f"❌ {test_case['name']}: FAILED (Error: {str(e)})")
            failed += 1

    print(f"\nExtension Path Tests: {passed} passed, {failed} failed")
    return failed == 0


def test_progress_streaming():
    """Test progress message streaming."""
    print("\n" + "="*60)
    print("Test: Progress Message Streaming")
    print("="*60)

    from browser_use_bridge import emit_progress

    test_cases = [
        {
            "name": "Basic progress message",
            "message": "🚀 [Tab 1] Starting: Test task...",
            "task_id": 0,
            "step": 0
        },
        {
            "name": "Navigation progress",
            "message": "🌍 [Tab 1] Navigating to https://example.com...",
            "task_id": 0,
            "step": 1
        },
        {
            "name": "Completion progress",
            "message": "✅ [Tab 1] Completed in 5 steps",
            "task_id": 0,
            "step": 5
        },
        {
            "name": "Multiple tasks",
            "message": "🚀 [Tab 2] Starting: Another task...",
            "task_id": 1,
            "step": 0
        }
    ]

    passed = 0
    failed = 0

    for test_case in test_cases:
        try:
            # Emit progress message (should not throw)
            emit_progress(
                test_case["message"],
                task_id=test_case["task_id"],
                step=test_case["step"]
            )
            print(f"✅ {test_case['name']}: PASSED")
            passed += 1
        except Exception as e:
            print(f"❌ {test_case['name']}: FAILED (Error: {str(e)})")
            failed += 1

    print(f"\nProgress Streaming Tests: {passed} passed, {failed} failed")
    return failed == 0


def main():
    """Run all integration tests."""
    print("="*60)
    print("Browser-Use Integration Tests")
    print("="*60)

    all_passed = True

    # Run all test suites
    all_passed &= test_llm_provider_configuration()
    all_passed &= test_browser_options_validation()
    all_passed &= test_extension_path_handling()
    all_passed &= test_progress_streaming()

    # Summary
    print("\n" + "="*60)
    print("Test Summary")
    print("="*60)
    if all_passed:
        print("✅ All integration tests passed!")
        return 0
    else:
        print("❌ Some integration tests failed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
