const { test, expect } = require( '@playwright/test' );
const wcApi = require( '@woocommerce/woocommerce-rest-api' ).default;
const { admin, customer } = require( '../../test-data/data' );
const { setFilterValue, clearFilters } = require( '../../utils/filters' );

const guestEmail = 'checkout-guest@example.com';

const simpleProductName = 'Very Simple Product';
const simpleProductDesc = 'Lorem ipsum dolor.';
const singleProductFullPrice = '150.00';
const singleProductSalePrice = '75.00';
const twoProductPrice = ( singleProductSalePrice * 2 ).toString();
const threeProductPrice = ( singleProductSalePrice * 3 ).toString();

const pageTitle = 'Checkout Block';
const pageSlug = pageTitle.replace( / /gi, '-' ).toLowerCase();

let guestOrderId1, guestOrderId2, customerOrderId, productId, shippingZoneId;

test.describe( 'Checkout Block page', () => {
	test.beforeAll( async ( { baseURL } ) => {
		const api = new wcApi( {
			url: baseURL,
			consumerKey: process.env.CONSUMER_KEY,
			consumerSecret: process.env.CONSUMER_SECRET,
			version: 'wc/v3',
		} );
		// ensure store address is US
		await api.post( 'settings/general/batch', {
			update: [
				{
					id: 'woocommerce_store_address',
					value: 'addr 1',
				},
				{
					id: 'woocommerce_store_city',
					value: 'San Francisco',
				},
				{
					id: 'woocommerce_default_country',
					value: 'US:CA',
				},
				{
					id: 'woocommerce_store_postcode',
					value: '94107',
				},
			],
		} );
		// add product
		await api
			.post( 'products', {
				name: simpleProductName,
				description: simpleProductDesc,
				type: 'simple',
				regular_price: singleProductFullPrice,
				sale_price: singleProductSalePrice,
			} )
			.then( ( response ) => {
				productId = response.data.id;
			} );
		// enable loggin through checkout
		await api.put(
			'settings/account/woocommerce_enable_checkout_login_reminder',
			{
				value: 'yes',
			}
		);
		// add a shipping zone and method
		await api
			.post( 'shipping/zones', {
				name: 'Free Shipping Oregon',
			} )
			.then( ( response ) => {
				shippingZoneId = response.data.id;
			} );
		await api.put( `shipping/zones/${ shippingZoneId }/locations`, [
			{
				code: 'US:CA',
				type: 'state',
			},
		] );
		await api.post( `shipping/zones/${ shippingZoneId }/methods`, {
			method_id: 'free_shipping',
		} );
		// enable bank transfers and COD for payment
		await api.put( 'payment_gateways/bacs', {
			enabled: true,
		} );
		await api.put( 'payment_gateways/cod', {
			enabled: true,
		} );
	} );

	test.afterAll( async ( { baseURL } ) => {
		const api = new wcApi( {
			url: baseURL,
			consumerKey: process.env.CONSUMER_KEY,
			consumerSecret: process.env.CONSUMER_SECRET,
			version: 'wc/v3',
		} );
		await api.delete( `products/${ productId }`, {
			force: true,
		} );
		await api.delete( `shipping/zones/${ shippingZoneId }`, {
			force: true,
		} );
		await api.put( 'payment_gateways/bacs', {
			enabled: false,
		} );
		await api.put( 'payment_gateways/cod', {
			enabled: false,
		} );
		await api.put(
			'settings/account/woocommerce_enable_checkout_login_reminder',
			{
				value: 'no',
			}
		);
		// delete the orders we created
		if ( guestOrderId1 ) {
			await api.delete( `orders/${ guestOrderId1 }`, { force: true } );
		}
		if ( guestOrderId2 ) {
			await api.delete( `orders/${ guestOrderId2 }`, { force: true } );
		}
		if ( customerOrderId ) {
			await api.delete( `orders/${ customerOrderId }`, { force: true } );
		}
	} );

	test.beforeEach( async ( { context } ) => {
		// Shopping cart is very sensitive to cookies, so be explicit
		await context.clearCookies();
	} );

	test( 'can see empty checkout block page', async ( { page } ) => {
		// create a new page with checkout block
		await page.goto( 'wp-admin/post-new.php?post_type=page' );
		await page.waitForLoadState( 'networkidle' );
		await page.locator( 'input[name="log"]' ).fill( admin.username );
		await page.locator( 'input[name="pwd"]' ).fill( admin.password );
		await page.locator( 'text=Log In' ).click();

		// Close welcome popup if prompted
		try {
			await page
				.getByLabel( 'Close', { exact: true } )
				.click( { timeout: 5000 } );
		} catch ( error ) {
			console.log( "Welcome modal wasn't present, skipping action." );
		}

		await page
			.getByRole( 'textbox', { name: 'Add title' } )
			.fill( pageTitle );
		await page.getByRole( 'button', { name: 'Add default block' } ).click();
		await page
			.getByRole( 'document', {
				name: 'Empty block; start writing or type forward slash to choose a block',
			} )
			.fill( '/checkout' );
		await page.keyboard.press( 'Enter' );
		await page
			.getByRole( 'button', { name: 'Publish', exact: true } )
			.click();
		await page
			.getByRole( 'region', { name: 'Editor publish' } )
			.getByRole( 'button', { name: 'Publish', exact: true } )
			.click();
		await expect(
			page.getByText( `${ pageTitle } is now live.` )
		).toBeVisible();

		// go to the page to test empty cart block
		await page.goto( pageSlug );
		await expect(
			page.getByRole( 'heading', { name: pageTitle } )
		).toBeVisible();
		await expect(
			page.getByText( 'Your cart is currently empty!' )
		).toBeVisible();
		await expect(
			page.getByRole( 'link', { name: 'Browse store' } )
		).toBeVisible();
		await page.getByRole( 'link', { name: 'Browse store' } ).click();
		await expect(
			page.getByRole( 'heading', { name: 'Shop' } )
		).toBeVisible();
	} );

	test( 'allows customer to choose available payment methods', async ( {
		page,
	} ) => {
		// this time we're going to add two products to the cart
		for ( let i = 1; i < 3; i++ ) {
			await page.goto( `/shop/?add-to-cart=${ productId }` );
			await page.waitForLoadState( 'networkidle' );
		}
		await page.goto( pageSlug );
		await expect(
			page.getByRole( 'heading', { name: pageTitle } )
		).toBeVisible();

		// check the order summary
		await expect(
			page.locator( '.wc-block-components-order-summary-item__quantity' )
		).toContainText( '2' );
		await expect(
			page.locator(
				'.wc-block-components-order-summary-item__individual-price'
			)
		).toContainText( `$${ singleProductSalePrice }` );
		await expect(
			page.locator( '.wc-block-components-product-metadata__description' )
		).toContainText( simpleProductDesc );
		await expect(
			page.locator(
				'.wc-block-components-totals-footer-item > .wc-block-components-totals-item__value'
			)
		).toContainText( twoProductPrice );

		// check the payment methods
		await expect( page.getByLabel( 'Direct bank transfer' ) ).toBeVisible();
		await expect( page.getByLabel( 'Cash on delivery' ) ).toBeVisible();
		await page.getByLabel( 'Cash on delivery' ).check();
		await expect( page.getByLabel( 'Cash on delivery' ) ).toBeChecked();
	} );

	test( 'allows customer to fill shipping details', async ( { page } ) => {
		// this time we're going to add three products to the cart
		for ( let i = 1; i < 4; i++ ) {
			await page.goto( `/shop/?add-to-cart=${ productId }` );
			await page.waitForLoadState( 'networkidle' );
		}
		await page.goto( pageSlug );
		await expect(
			page.getByRole( 'heading', { name: pageTitle } )
		).toBeVisible();

		// check the order summary
		await expect(
			page.locator( '.wc-block-components-order-summary-item__quantity' )
		).toContainText( '3' );
		await expect(
			page.locator(
				'.wc-block-components-totals-footer-item > .wc-block-components-totals-item__value'
			)
		).toContainText( threeProductPrice );

		// asserting that you can fill in the shipping details
		await expect( page.getByLabel( 'Email address' ) ).toBeEditable();
		await expect( page.getByLabel( 'First name' ) ).toBeEditable();
		await expect( page.getByLabel( 'Last name' ) ).toBeEditable();
		await expect(
			page.getByLabel( 'Address', { exact: true } )
		).toBeEditable();
		await expect(
			page.getByLabel( 'Apartment, suite, etc. (optional)' )
		).toBeEnabled();
		await expect(
			page.getByLabel( 'United States (US), Country/Region' )
		).toBeEditable();
		await expect( page.getByLabel( 'California, State' ) ).toBeEditable();
		await expect( page.getByLabel( 'City' ) ).toBeEditable();
		await expect( page.getByLabel( 'ZIP Code' ) ).toBeEnabled();
		await expect( page.getByLabel( 'Phone (optional)' ) ).toBeEditable();
	} );

	test( 'allows customer to fill different shipping and billing details', async ( {
		page,
	} ) => {
		await page.goto( `/shop/?add-to-cart=${ productId }`, {
			waitUntil: 'networkidle',
		} );
		await page.goto( pageSlug );
		await expect(
			page.getByRole( 'heading', { name: pageTitle } )
		).toBeVisible();

		// fill shipping address
		await page.getByLabel( 'Email address' ).fill( guestEmail );
		await page.getByLabel( 'First name' ).fill( 'Homer' );
		await page.getByLabel( 'Last name' ).fill( 'Simpson' );
		await page
			.getByLabel( 'Address', { exact: true } )
			.fill( '123 Evergreen Terrace' );
		await page.getByLabel( 'City' ).fill( 'Springfield' );
		await page.getByLabel( 'ZIP Code' ).fill( '97403' );

		// fill billing details
		await page.getByLabel( 'Use same address for billing' ).click();
		await page.getByLabel( 'First name' ).last().fill( 'Mister' );
		await page.getByLabel( 'Last name' ).last().fill( 'Burns' );
		await page
			.getByLabel( 'Address', { exact: true } )
			.last()
			.fill( '156th Street' );
		await page.getByLabel( 'City' ).last().fill( 'Springfield' );
		await page.getByLabel( 'ZIP Code' ).last().fill( '98500' );

		// add note to the order
		await page.getByLabel( 'Add a note to your order' ).check();
		await page
			.getByPlaceholder(
				'Notes about your order, e.g. special notes for delivery.'
			)
			.fill( 'Ship it fast.' );

		// place an order
		await page.getByRole( 'button', { name: 'Place order' } ).click();
		await expect(
			page.getByRole( 'heading', { name: 'Order received' } )
		).toBeVisible();

		// get order ID from the page
		const orderReceivedText = await page
			.locator( '.woocommerce-order-overview__order.order' )
			.textContent();
		guestOrderId2 = await orderReceivedText
			.split( /(\s+)/ )[ 6 ]
			.toString();

		// go again to the checkout to verify details
		await page.goto( `/shop/?add-to-cart=${ productId }`, {
			waitUntil: 'networkidle',
		} );
		await page.goto( pageSlug );
		await expect(
			page.getByRole( 'heading', { name: pageTitle } )
		).toBeVisible();

		// expand shipping and billing details
		await page
			.getByLabel( 'Edit address', { exact: true } )
			.first()
			.click();
		await page.getByLabel( 'Edit address', { exact: true } ).last().click();

		// verify shipping details
		await expect( page.getByLabel( 'First name' ).first() ).toHaveValue(
			'Homer'
		);
		await expect( page.getByLabel( 'Last name' ).first() ).toHaveValue(
			'Simpson'
		);
		await expect(
			page.getByLabel( 'Address', { exact: true } ).first()
		).toHaveValue( '123 Evergreen Terrace' );
		await expect( page.getByLabel( 'City' ).first() ).toHaveValue(
			'Springfield'
		);
		await expect( page.getByLabel( 'ZIP Code' ).first() ).toHaveValue(
			'97403'
		);

		// verify billing details
		await expect( page.getByLabel( 'First name' ).last() ).toHaveValue(
			'Mister'
		);
		await expect( page.getByLabel( 'Last name' ).last() ).toHaveValue(
			'Burns'
		);
		await expect(
			page.getByLabel( 'Address', { exact: true } ).last()
		).toHaveValue( '156th Street' );
		await expect( page.getByLabel( 'City' ).last() ).toHaveValue(
			'Springfield'
		);
		await expect( page.getByLabel( 'ZIP Code' ).last() ).toHaveValue(
			'98500'
		);
	} );

	test( 'warn when customer is missing required details', async ( {
		page,
	} ) => {
		await page.goto( `/shop/?add-to-cart=${ productId }`, {
			waitUntil: 'networkidle',
		} );
		await page.goto( pageSlug );
		await expect(
			page.getByRole( 'heading', { name: pageTitle } )
		).toBeVisible();

		// first try submitting the form with no fields complete
		await page.getByRole( 'button', { name: 'Place order' } ).click();
		await expect(
			page.getByText( 'Please enter a valid email address' )
		).toBeVisible();
		await expect(
			page.getByText( 'Please enter a valid first name' )
		).toBeVisible();
		await expect(
			page.getByText( 'Please enter a valid last name' )
		).toBeVisible();
		await expect(
			page.getByText( 'Please enter a valid address' )
		).toBeVisible();
		await expect(
			page.getByText( 'Please enter a valid city' )
		).toBeVisible();
		await expect(
			page.getByText( 'Please enter a valid zip code' )
		).toBeVisible();
	} );

	test( 'allows customer to fill shipping details and toggle different billing', async ( {
		page,
	} ) => {
		await page.goto( `/shop/?add-to-cart=${ productId }`, {
			waitUntil: 'networkidle',
		} );
		await page.goto( pageSlug );
		await expect(
			page.getByRole( 'heading', { name: pageTitle } )
		).toBeVisible();

		// fill shipping address and check the toggle to use a different address for billing
		await page.getByLabel( 'Email address' ).fill( customer.email );
		await page.getByLabel( 'First name' ).fill( 'Homer' );
		await page.getByLabel( 'Last name' ).fill( 'Simpson' );
		await page
			.getByLabel( 'Address', { exact: true } )
			.fill( '123 Evergreen Terrace' );
		await page.getByLabel( 'City' ).fill( 'Springfield' );
		await page.getByLabel( 'ZIP Code' ).fill( '97403' );
		await expect(
			page.getByLabel( 'Use same address for billing' )
		).toBeVisible();
		await page.getByLabel( 'Use same address for billing' ).click();
		await expect(
			page
				.getByRole( 'group', { name: 'Billing address' } )
				.locator( 'h2' )
		).toBeVisible();
	} );

	test( 'allows guest customer to place an order', async ( { page } ) => {
		for ( let i = 1; i < 3; i++ ) {
			await page.goto( `/shop/?add-to-cart=${ productId }` );
			await page.waitForLoadState( 'networkidle' );
		}
		await page.goto( pageSlug );
		await expect(
			page.getByRole( 'heading', { name: pageTitle } )
		).toBeVisible();

		// fill shipping address and check cash on delivery method
		await page.getByLabel( 'Email address' ).fill( guestEmail );
		await page.getByLabel( 'First name' ).fill( 'Homer' );
		await page.getByLabel( 'Last name' ).fill( 'Simpson' );
		await page
			.getByLabel( 'Address', { exact: true } )
			.fill( '123 Evergreen Terrace' );
		await page.getByLabel( 'City' ).fill( 'Springfield' );
		await page.getByLabel( 'ZIP Code' ).fill( '97403' );
		await page.getByLabel( 'Cash on delivery' ).check();
		await expect( page.getByLabel( 'Cash on delivery' ) ).toBeChecked();

		// add note to the order
		await page.getByLabel( 'Add a note to your order' ).check();
		await page
			.getByPlaceholder(
				'Notes about your order, e.g. special notes for delivery.'
			)
			.fill( 'Please ship this order ASAP!' );

		// place an order
		await page.getByRole( 'button', { name: 'Place order' } ).click();
		await expect(
			page.getByRole( 'heading', { name: 'Order received' } )
		).toBeVisible();

		// get order ID from the page
		const orderReceivedText = await page
			.locator( '.woocommerce-order-overview__order.order' )
			.textContent();
		guestOrderId1 = await orderReceivedText
			.split( /(\s+)/ )[ 6 ]
			.toString();

		// Let's simulate a new browser context (by dropping all cookies), and reload the page. This approximates a
		// scenario where the server can no longer identify the shopper. However, so long as we are within the 10 minute
		// grace period following initial order placement, the 'order received' page should still be rendered.
		await page.context().clearCookies();
		await page.reload();
		await expect(
			page.getByRole( 'heading', { name: 'Order received' } )
		).toBeVisible();

		// Let's simulate a scenario where the 10 minute grace period has expired. This time, we expect the shopper to
		// be presented with a request to verify their email address.
		await setFilterValue(
			page,
			'woocommerce_order_email_verification_grace_period',
			0
		);
		await page.reload();
		await expect(
			page.locator( 'form.woocommerce-verify-email p:nth-child(3)' )
		).toContainText( /verify the email address associated with the order/ );

		// Supplying an email address other than the actual order billing email address will take them back to the same
		// page with an error message.
		await page.fill( '#email', 'incorrect@email.address' );
		await page.locator( 'form.woocommerce-verify-email button' ).click();
		await expect(
			page.locator( 'form.woocommerce-verify-email p:nth-child(4)' )
		).toContainText( /verify the email address associated with the order/ );
		await expect( page.locator( 'ul.woocommerce-error li' ) ).toContainText(
			/We were unable to verify the email address you provided/
		);

		// However if they supply the *correct* billing email address, they should see the order received page again.
		await page.fill( '#email', guestEmail );
		await page.locator( 'form.woocommerce-verify-email button' ).click();
		await expect(
			page.getByRole( 'heading', { name: 'Order received' } )
		).toBeVisible();

		await page.goto( 'wp-login.php' );
		await page.locator( 'input[name="log"]' ).fill( admin.username );
		await page.locator( 'input[name="pwd"]' ).fill( admin.password );
		await page.locator( 'text=Log In' ).click();

		// load the order placed as a guest
		await page.goto(
			`wp-admin/post.php?post=${ guestOrderId1 }&action=edit`
		);

		await expect(
			page.getByRole( 'heading', {
				name: `Order #${ guestOrderId1 } details`,
			} )
		).toBeVisible();
		await expect( page.locator( '.wc-order-item-name' ) ).toContainText(
			simpleProductName
		);
		await expect( page.locator( 'td.quantity >> nth=0' ) ).toContainText(
			'2'
		);
		await expect( page.locator( 'td.item_cost >> nth=0' ) ).toContainText(
			singleProductSalePrice
		);
		await expect( page.locator( 'td.line_cost >> nth=0' ) ).toContainText(
			twoProductPrice
		);
		await clearFilters( page );
	} );

	test( 'allows existing customer to place an order', async ( { page } ) => {
		for ( let i = 1; i < 3; i++ ) {
			await page.goto( `/shop/?add-to-cart=${ productId }` );
			await page.waitForLoadState( 'networkidle' );
		}
		await page.goto( pageSlug );
		await expect(
			page.getByRole( 'heading', { name: pageTitle } )
		).toBeVisible();

		// click to log in and make sure you are on the same page after logging in
		await page.getByText( 'Log in' ).click();
		await page
			.locator( 'input[name="username"]' )
			.fill( customer.username );
		await page
			.locator( 'input[name="password"]' )
			.fill( customer.password );
		await page.locator( 'text=Log In' ).click();
		await page.waitForLoadState( 'networkidle' );

		// try to edit shipping details if already prefilled
		try {
			await page
				.getByLabel( 'Edit address', { exact: true } )
				.click( { timeout: 3000 } );
		} catch ( error ) {
			console.log( 'No shipping details prefilled, skipping action.' );
		}

		// fill shipping address and check cash on delivery method
		await page.getByLabel( 'Email address' ).fill( customer.email );
		await page.getByLabel( 'First name' ).fill( 'Homer' );
		await page.getByLabel( 'Last name' ).fill( 'Simpson' );
		await page
			.getByLabel( 'Address', { exact: true } )
			.fill( '123 Evergreen Terrace' );
		await page.getByLabel( 'City' ).fill( 'Springfield' );
		await page.getByLabel( 'ZIP Code' ).fill( '97403' );
		await page.getByLabel( 'Cash on delivery' ).check();
		await expect( page.getByLabel( 'Cash on delivery' ) ).toBeChecked();

		// place an order
		await page.getByRole( 'button', { name: 'Place order' } ).click();
		await expect(
			page.getByRole( 'heading', { name: 'Order received' } )
		).toBeVisible();

		// get order ID from the page
		const orderReceivedText = await page
			.locator( '.woocommerce-order-overview__order.order' )
			.textContent();
		customerOrderId = await orderReceivedText
			.split( /(\s+)/ )[ 6 ]
			.toString();

		// Effect a log out/simulate a new browsing session by dropping all cookies.
		await page.context().clearCookies();
		await page.reload();

		// Now we are logged out, return to the confirmation page: we should be asked to log back in.
		await expect( page.locator( '.woocommerce-info' ) ).toContainText(
			/Please log in to your account to view this order/
		);

		// Switch to admin user.
		await page.goto( 'wp-login.php?loggedout=true' );
		await page.locator( 'input[name="log"]' ).fill( admin.username );
		await page.locator( 'input[name="pwd"]' ).fill( admin.password );
		await page.locator( 'text=Log In' ).click();

		// load the order placed as a customer
		await page.goto(
			`wp-admin/post.php?post=${ customerOrderId }&action=edit`
		);
		await expect(
			page.locator( 'h2.woocommerce-order-data__heading' )
		).toContainText( `Order #${ customerOrderId } details` );
		await expect( page.locator( '.wc-order-item-name' ) ).toContainText(
			simpleProductName
		);
		await expect( page.locator( 'td.quantity >> nth=0' ) ).toContainText(
			'2'
		);
		await expect( page.locator( 'td.item_cost >> nth=0' ) ).toContainText(
			singleProductSalePrice
		);
		await expect( page.locator( 'td.line_cost >> nth=0' ) ).toContainText(
			twoProductPrice
		);
	} );
} );
