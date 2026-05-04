use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::Html,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqlitePoolOptions, FromRow, SqlitePool};
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[derive(Debug, Serialize, Deserialize, FromRow)]
struct Restaurant {
    id: i64,
    name: String,
    lat: f64,
    lng: f64,
    menu_url: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct CreateRestaurant {
    name: String,
    lat: f64,
    lng: f64,
    menu_url: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct Pagination {
    limit: Option<i64>,
    offset: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
struct RestaurantList {
    total: i64,
    restaurants: Vec<Restaurant>,
}

#[derive(Debug, Serialize, Deserialize)]
struct AiSearchRequest {
    query: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct UpdateCoordsRequest {
    id: Option<i64>,
    name: Option<String>,
    lat: Option<f64>,
    lng: Option<f64>,
    menu_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct BulkUpdateRequest {
    restaurants: Vec<UpdateCoordsRequest>,
}

async fn update_coords(
    State(pool): State<SqlitePool>,
    Json(payload): Json<BulkUpdateRequest>,
) -> Result<Json<Vec<Restaurant>>, (StatusCode, String)> {
    let api_key = std::env::var("ADMIN_API_KEY").unwrap_or_default();
    if api_key.is_empty() {
        return Err((StatusCode::FORBIDDEN, "Admin access denied".into()));
    }

    let mut updated = Vec::new();
    for rest in payload.restaurants {
        // Try UPDATE first
        let result = sqlx::query(
            "UPDATE restaurants SET lat = COALESCE(?, lat), lng = COALESCE(?, lng), menu_url = COALESCE(?, menu_url) WHERE id = ?"
        )
        .bind(rest.lat)
        .bind(rest.lng)
        .bind(&rest.menu_url)
        .bind(rest.id)
        .execute(&pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        if result.rows_affected() > 0 {
            // Updated existing
            let r = sqlx::query_as::<_, Restaurant>("SELECT * FROM restaurants WHERE id = ?")
                .bind(rest.id)
                .fetch_one(&pool)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            updated.push(r);
        } else if let (Some(name), Some(lat), Some(lng)) = (&rest.name, rest.lat, rest.lng) {
            // Insert NEW restaurant
            let result = sqlx::query(
                "INSERT INTO restaurants (name, lat, lng, menu_url) VALUES (?, ?, ?, ?)"
            )
            .bind(&name)
            .bind(lat)
            .bind(lng)
            .bind(&rest.menu_url)
            .execute(&pool)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            
            let id = result.last_insert_rowid();
            let r = sqlx::query_as::<_, Restaurant>("SELECT * FROM restaurants WHERE id = ?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            updated.push(r);
        }
    }

    Ok(Json(updated))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    // Initialize logging
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "allqrmap=debug".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Database setup
    let db_url = "sqlite:restaurants.db?mode=rwc";
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(db_url)
        .await?;

    // Initialize database schema and seed data
    init_db(&pool).await?;

    // CORS configuration
    let cors = CorsLayer::permissive();

    // Application router
    let app = Router::new()
        .route("/", get(serve_index))
        .route("/api/admin/update-coords", post(update_coords))
        .route("/api/ai-search", post(ai_search))
        .fallback_service(ServeDir::new("static"))
        .layer(cors)
        .with_state(pool);

    // Run the server
    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    tracing::debug!("listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();

    Ok(())
}

async fn init_db(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS restaurants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            lat REAL NOT NULL,
            lng REAL NOT NULL,
            menu_url TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM restaurants")
        .fetch_one(pool)
        .await?;

    if count == 0 {
        tracing::info!("Seeding database with expanded real Turkish restaurants...");
        
        let mut restaurants: Vec<(String, f64, f64, String)> = vec![
            // Fine Dining & Famous
            ("Nusr-Et Steakhouse Sandal Bedesteni", 41.0125, 28.9682, "https://www.nusr-et.com.tr/menu"),
            ("Mikla Restaurant", 41.0345, 28.9814, "https://www.miklarestaurant.com/tr/menu/mikla-menu"),
            ("Zübeyir Ocakbaşı", 41.0368, 28.9800, "https://zubeyirocakbasi.com.tr/menu"),
            ("Karaköy Güllüoğlu", 41.0245, 28.9775, "https://www.karakoygulluoglu.com/menu"),
            ("Hafiz Mustafa 1864 Sultanahmet", 41.0142, 28.9774, "https://www.hafizmustafa.com/menu/"),
            ("Karaköy Lokantası", 41.0235, 28.9785, "https://www.karakoylokantasi.com/menu"),
            ("Hacı Abdullah Lokantası", 41.0353, 28.9803, "https://www.haciabdullah.com.tr/menu"),
            ("1924 Istanbul", 41.0315, 28.9755, "https://www.1924istanbul.com/menu"),
            
            // Beşiktaş
            ("Karadeniz Döner Asım Usta", 41.0425, 29.0072, "https://www.karadenizdonerasimusta.com/menu"),
            ("Feriye Lokantası", 41.0461, 29.0214, "https://www.feriye.com/menu"),
            ("Alaf Kuruçeşme", 41.0535, 29.0345, "https://www.alafkurucesme.com/menu"),
            ("Tuğra Restaurant", 41.0441, 29.0167, "https://www.tugrarestaurant.com.tr/menu"),
            ("Vogue Restaurant", 41.0415, 29.0012, "https://www.voguerestaurantandbar.com/menu"),
            
            // Kadıköy
            ("Borsam Taşfırın", 40.9892, 29.0261, "https://www.borsamtasfirin.com/menu"),
            ("Yanyalı Fehmi Lokantası", 40.9915, 29.0275, "https://www.yanyali.com/menu"),
            ("The Townhouse", 40.9615, 29.0855, "https://thetownhouseistanbul.com/menu"),
            ("Viktor Levi Şarap Evi", 40.9865, 29.0285, "https://viktorlevisarapevi.com/menu"),
            
            // Nişantaşı & Şişli
            ("Delicatessen Nişantaşı", 41.0485, 28.9935, "https://www.delicatessen.com.tr/menu"),
            ("Göreme Muhallebicisi", 41.0515, 28.9815, "https://www.gorememuhallebicisi.com/menu"),
            ("Adana Ocakbaşı Kurtuluş", 41.0525, 28.9845, "https://www.adanaocakbasi.com/menu"),
            ("Spago Istanbul", 41.0475, 28.9954, "https://www.spago.com.tr/menu"),
            
            // Chain: Midpoint
            ("Midpoint Nişantaşı", 41.0492, 28.9931, "https://www.midpoint.com.tr/menu"),
            ("Midpoint Bağdat Caddesi", 40.9634, 29.0682, "https://www.midpoint.com.tr/menu"),
            ("Midpoint Tünel", 41.0281, 28.9754, "https://www.midpoint.com.tr/menu"),
            ("Midpoint Watergarden", 40.9931, 29.1014, "https://www.midpoint.com.tr/menu"),
            ("Midpoint Kanyon", 41.0782, 29.0114, "https://www.midpoint.com.tr/menu"),
            
            // Chain: BigChefs
            ("BigChefs Tarabya", 41.1385, 29.0562, "https://www.bigchefs.com.tr/menu"),
            ("BigChefs Tünel", 41.0283, 28.9751, "https://www.bigchefs.com.tr/menu"),
            ("BigChefs Metropol", 40.9942, 29.1215, "https://www.bigchefs.com.tr/menu"),
            ("BigChefs Gayrettepe", 41.0681, 29.0064, "https://www.bigchefs.com.tr/menu"),
            ("BigChefs Anadolu Hisarı", 41.0825, 29.0664, "https://www.bigchefs.com.tr/menu"),
            
            // Chain: Cookshop
            ("Cookshop Akaretler", 41.0412, 29.0004, "https://cookshop.com.tr/menu"),
            ("Cookshop Galataport", 41.0265, 28.9842, "https://cookshop.com.tr/menu"),
            ("Cookshop Caddebostan", 40.9631, 29.0635, "https://cookshop.com.tr/menu"),
            ("Cookshop Vadistanbul", 41.1072, 28.9874, "https://cookshop.com.tr/menu"),
            ("Cookshop Emaar Square", 41.0045, 29.0654, "https://cookshop.com.tr/menu"),
            
            // Chain: Happy Moon's
            ("Happy Moon's Kadıköy", 40.9882, 29.0314, "https://happygroup.com.tr/menu/"),
            ("Happy Moon's Emaar", 41.0045, 29.0662, "https://happygroup.com.tr/menu/"),
            ("Happy Moon's City's Nişantaşı", 41.0501, 28.9934, "https://happygroup.com.tr/menu/"),
            ("Happy Moon's Akasya", 41.0012, 29.0541, "https://happygroup.com.tr/menu/"),
            ("Happy Moon's Maltepe Park", 40.9234, 29.1564, "https://happygroup.com.tr/menu/"),
            
            // Local Heroes & Others
            ("Bayramoğlu Döner", 41.0965, 29.0910, "https://www.bayramogludoner.com.tr/menu"),
            ("Çiya Sofrası", 40.9886, 29.0234, "https://ciya.com.tr/menu/"),
            ("Günaydın Steakhouse İstinye", 41.1085, 29.0212, "https://www.gunaydinet.com/menu"),
            ("Namlı Gurme Karaköy", 41.0242, 28.9745, "https://www.namligurme.com.tr/menu"),
            ("Mangerie Bebek", 41.0765, 29.0434, "https://www.mangeriebebek.com/menu"),
            ("Lucca Bebek", 41.0772, 29.0445, "https://www.luccastyle.com/menu"),
            
            // Other Cities
            ("Aspava Yıldız (Ankara)", 39.9075, 32.8620, "https://aspava.com.tr/menu"),
            ("7 Mehmet (Antalya)", 36.8835, 30.6580, "https://www.7mehmet.com/menu"),
            ("Balıkçı Kenan (Antalya)", 36.8845, 30.7012, "https://www.balikcikenan.com/menu"),
            ("Deniz Restaurant (İzmir)", 38.4354, 27.1384, "https://www.denizrestaurant.com.tr/menu"),
        ].into_iter().map(|(n, la, ln, m)| (n.to_string(), la, ln, m.to_string())).collect();

        // Check if external restaurants.json exists and import it
        if let Ok(content) = std::fs::read_to_string("restaurants.json") {
            if let Ok(external_list) = serde_json::from_str::<Vec<CreateRestaurant>>(&content) {
                tracing::info!("Importing {} restaurants from restaurants.json", external_list.len());
                for res in external_list {
                    restaurants.push((res.name, res.lat, res.lng, res.menu_url));
                }
            }
        }

        for (name, lat, lng, menu_url) in restaurants {
            sqlx::query("INSERT INTO restaurants (name, lat, lng, menu_url) VALUES (?, ?, ?, ?)")
                .bind(name)
                .bind(lat)
                .bind(lng)
                .bind(menu_url)
                .execute(pool)
                .await?;
        }
    }

    Ok(())
}

async fn get_restaurants(
    State(pool): State<SqlitePool>,
) -> Result<Json<Vec<Restaurant>>, (StatusCode, String)> {
    let restaurants = sqlx::query_as::<_, Restaurant>("SELECT * FROM restaurants")
        .fetch_all(&pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(restaurants))
}

async fn get_restaurants_limited(
    State(pool): State<SqlitePool>,
) -> Result<Json<Vec<Restaurant>>, (StatusCode, String)> {
    let restaurants = sqlx::query_as::<_, Restaurant>("SELECT * FROM restaurants WHERE lat != 0 AND lng != 0")
        .fetch_all(&pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(restaurants))
}

async fn get_public_restaurants(
    State(pool): State<SqlitePool>,
    Query(params): Query<Pagination>,
) -> Result<Json<RestaurantList>, (StatusCode, String)> {
    let limit = params.limit.unwrap_or(50).min(100);
    let offset = params.offset.unwrap_or(0);
    
    let restaurants = sqlx::query_as::<_, Restaurant>(
        "SELECT id, name, lat, lng, menu_url FROM restaurants WHERE lat != 0 AND lng != 0 LIMIT ? OFFSET ?"
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let total = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM restaurants WHERE lat != 0 AND lng != 0"
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(RestaurantList { total, restaurants }))
}

async fn create_restaurant(
    State(pool): State<SqlitePool>,
    Json(payload): Json<CreateRestaurant>,
) -> Result<Json<Restaurant>, (StatusCode, String)> {
    let result = sqlx::query(
        "INSERT INTO restaurants (name, lat, lng, menu_url) VALUES (?, ?, ?, ?)"
    )
    .bind(&payload.name)
    .bind(payload.lat)
    .bind(payload.lng)
    .bind(&payload.menu_url)
    .execute(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let id = result.last_insert_rowid();

    let restaurant = Restaurant {
        id,
        name: payload.name,
        lat: payload.lat,
        lng: payload.lng,
        menu_url: payload.menu_url,
    };

    Ok(Json(restaurant))
}

async fn ai_search(
    State(pool): State<SqlitePool>,
    Json(payload): Json<AiSearchRequest>,
) -> Result<Json<Vec<i64>>, (StatusCode, String)> {
    let api_key = std::env::var("GEMINI_API_KEY")
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "GEMINI_API_KEY not set".into()))?;

    // Fetch all restaurants to provide context to AI
    let restaurants = sqlx::query_as::<_, Restaurant>("SELECT * FROM restaurants")
        .fetch_all(&pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let restaurants_context = restaurants
        .iter()
        .map(|r| format!("ID: {}, Name: {}, Menu: {}", r.id, r.name, r.menu_url))
        .collect::<Vec<_>>()
        .join("\n");

    let prompt = format!(
        "You are a helpful assistant for a restaurant map app. 
        Based on the following list of restaurants:\n{}\n
        Which ones best match the user's query: '{}'? 
        Return ONLY a raw JSON array of the matching IDs (e.g., [1, 2, 5]). 
        If no matches, return []. Do not include any other text or markdown formatting.",
        restaurants_context, payload.query
    );

    let client = reqwest::Client::new();
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key={}",
        api_key
    );

    let response = client
        .post(url)
        .json(&serde_json::json!({
            "contents": [{
                "parts": [{
                    "text": prompt
                }]
            }]
        }))
        .send()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let gemini_response: serde_json::Value = response
        .json()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tracing::debug!("Gemini Response: {:?}", gemini_response);

    // Check for errors in the response body
    if let Some(error) = gemini_response.get("error") {
        let msg = error["message"].as_str().unwrap_or("Unknown Gemini Error");
        return Err((StatusCode::INTERNAL_SERVER_ERROR, format!("Gemini API Error: {}", msg)));
    }

    // Extract the text from Gemini response
    let ai_text = gemini_response["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .ok_or_else(|| {
            let reason = gemini_response["candidates"][0]["finishReason"].as_str().unwrap_or("unknown");
            (StatusCode::INTERNAL_SERVER_ERROR, format!("AI response blocked or empty. Reason: {}", reason))
        })?
        .trim();

    // Remove markdown code blocks if present
    let cleaned_text = ai_text.replace("```json", "").replace("```", "").trim().to_string();

    let matching_ids: Vec<i64> = serde_json::from_str(&cleaned_text)
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, format!("AI returned invalid JSON: {}", cleaned_text)))?;

    Ok(Json(matching_ids))
}

async fn serve_index() -> Result<Html<String>, (StatusCode, String)> {
    let mut html = std::fs::read_to_string("static/index.html")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let ga_id = std::env::var("GA_MEASUREMENT_ID").unwrap_or_default();
    html = html.replace("G-XXXXXXXXXX", &ga_id);

    Ok(Html(html))
}
