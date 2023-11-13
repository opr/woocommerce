<?php

namespace Automattic\WooCommerce\Tests\Templating;

use Automattic\WooCommerce\Templating\TemplatingEngine;
use Automattic\WooCommerce\Utilities\StringUtil;

class TemplatingEngineTest extends \WC_Unit_Test_Case {
	private TemplatingEngine $sut;

	public function setUp(): void {
		parent::set_up();
		$this->reset_container_resolutions();
		$this->sut = $this->get_instance_of(TemplatingEngine::class);

		//Change the default templates directory to be the one in the tests directory
		$this->register_legacy_proxy_function_mocks(
			['dirname' => function($path) {
				return false === StringUtil::ends_with($path, '/Templating/TemplatingEngine.php') ?
					dirname($path) : __DIR__;
			}]
		);

	}

	public function test_render_template_throws_if_template_not_found() {
		$this->expectException(\InvalidArgumentException::class);
		$this->expectExceptionMessage('Template not found: BADTEMPLATE');

		$this->sut->render_template('BADTEMPLATE', []);
	}

	public function test_render_template_throws_if_directory_traversal_is_attempted() {
		$this->expectException(\InvalidArgumentException::class);
		$this->expectExceptionMessage('Template not found: ../misplaced');

		$this->sut->render_template('../misplaced', []);
	}

	public function test_render_template_throws_on_infinite_loop() {
		$original_xdebug_max_nesting_level = ini_get('xdebug.max_nesting_level');

		// This is needed to prevent "Xdebug has detected a possible infinite loop" error to be thrown
		// before we detect the infinite loop ourselves.
		ini_set('xdebug.max_nesting_level', 10000);

		$this->expectException(\OverflowException::class);
		$this->expectExceptionMessage('Template rendering depth of 256 levels reached, possible circular reference when rendering secondary templates.');

		try {
			$this->sut->render_template('infinite_loop', []);
		}
		finally {
			ini_set('xdebug.max_nesting_level', $original_xdebug_max_nesting_level);
		}
	}

	public function test_render_template_throws_if_no_expiration_date_is_supplied() {
		$this->expectException(\InvalidArgumentException::class);
		$this->expectExceptionMessage('The metadata array must have either an expiration_date key or an expiration_seconds key');

		$this->sut->render_template('simple', [], ['no_expiration_date_here' => 'nope']);
	}

	/**
	 * @testWith ["BAD_DATE", "BAD_DATE"]
	 *           [[], "array"]
	 *
	 * @return void
	 * @throws \Exception
	 */
	public function test_render_template_throws_if_invalid_expiration_date_is_supplied($value, $expected_value_representation) {
		$this->expectException(\InvalidArgumentException::class);
		$this->expectExceptionMessage("$expected_value_representation is not a valid date, expected format: year-month-day hour:minute:second");

		$this->sut->render_template('simple', [], ['expiration_date' => $value]);
	}

	/**
	 * @testWith ["BAD_SECONDS", "BAD_SECONDS"]
	 *           [[], "array"]
	 *           [59, "59"]
	 *           [-1, "-1"]
	 *
	 * @return void
	 * @throws \Exception
	 */
	public function test_render_template_throws_if_invalid_expiration_seconds_is_supplied($value, $expected_value_representation) {
		$this->expectException(\InvalidArgumentException::class);
		$this->expectExceptionMessage("Expiration_seconds must be a number and have a minimum value of 60, got $expected_value_representation");

		$this->sut->render_template('simple', [], ['expiration_seconds' => $value]);
	}

	public function test_render_template_throws_if_directory_cant_be_created() {
		$this->register_legacy_proxy_function_mocks(
			['wp_upload_dir' => fn() => ['basedir' => '/wordpress/uploads'],
				'realpath' => fn($path) => '/real' . $path,
				'is_dir' => fn() => false,
				'wp_mkdir_p' => fn() => false
				]
		);

		$this->expectException(\Exception::class);
		$this->expectExceptionMessage("Can't create directory: /real/wordpress/uploads/woocommerce_rendered_templates");

		$this->sut->render_template('simple', [], ['expiration_date' => '2100-01-01 00:00:00']);
	}

	public function test_render_template_throws_if_file_cant_be_created() {
		$this->register_legacy_proxy_function_mocks(
			['wp_upload_dir' => fn() => ['basedir' => '/wordpress/uploads'],
				'realpath' => fn($path) => '/real' . $path,
				'is_dir' => fn() => true,
				'fopen' => fn() => false
			]
		);

		$this->expectException(\Exception::class);
		$this->expectExceptionMessage("Can't create file to render template 'simple'");

		$this->sut->render_template('simple', [], ['expiration_date' => '2100-01-01 00:00:00']);
	}

	public function test_render_template_returns_rendered_template_as_string_if_no_metadata_supplied() {
		$result = $this->sut->render_template('simple', ['foo' => 'TheFoo', 'bar' => 'TheBar']);
		$this->assertEquals('Simple: foo = TheFoo, bar = TheBar', trim($result));
	}

	public function test_render_template_supports_custom_extension() {
		$result = $this->sut->render_template('with_custom.extension', []);
		$this->assertEquals('Template with custom extension.', trim($result));
	}

	public function test_render_template_with_subtemplates() {
		$result = $this->sut->render_template('complex/main', ['foo' => 'foo 1', 'bar' => 'TheBar']);
		$expected =
"Main template.
Initial foo = foo 1, bar = TheBar
Subtemplate! foo = foo 2, bar = TheBar
Subtemplate! foo = foo 3, bar = TheBar
Simple: foo = foo 4, bar = TheBar 2
Final foo = foo 1, bar = TheBar";
		$this->assertEquals($expected, trim($result));
	}

	public function test_render_template_to_file() {

	}

	public function test_rendered_files_directory_is_rooted_in_uploads_directory() {
		$this->register_legacy_proxy_function_mocks(
			['wp_upload_dir' => fn() => ['basedir' => '/wordpress/uploads'],
				'realpath' => fn($path) => '/real' . $path]
		);

		$result = $this->sut->get_rendered_files_directory();

		$this->assertEquals('/real/wordpress/uploads/woocommerce_rendered_templates', $result);
	}

	public function test_rendered_files_directory_can_be_changed_via_hook() {
		$original_directory = null;

		add_filter('woocommerce_rendered_templates_directory', function($path) use (&$original_directory) {
			$original_directory = $path;
		 	return '/my/templates';
		});

		$this->register_legacy_proxy_function_mocks(
			['wp_upload_dir' => fn() => ['basedir' => '/wordpress/uploads'],
				'realpath' => fn($path) => '/real' . $path]
		);

		$result = $this->sut->get_rendered_files_directory();

		remove_all_filters('woocommerce_rendered_templates_directory');

		$this->assertEquals('/wordpress/uploads/woocommerce_rendered_templates', $original_directory);
		$this->assertEquals('/real/my/templates', $result);
	}

	public function test_get_rendered_files_directory_throws_if_directory_does_not_exist() {
		$this->register_legacy_proxy_function_mocks(
			['wp_upload_dir' => fn() => ['basedir' => '/wordpress/uploads'],
				'realpath' => fn($path) => false]
		);

		$this->expectException(\Exception::class);
		$this->expectExceptionMessage("The base rendered templates directory doesn't exist: /wordpress/uploads/woocommerce_rendered_templates");

		$this->sut->get_rendered_files_directory();
	}
}
