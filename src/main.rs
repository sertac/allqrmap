use axum::{
    extract::State,
    http::StatusCode,
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
struct AiSearchRequest {
    query: String,
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
        .route("/api/restaurants", get(get_restaurants).post(create_restaurant))
        .route("/api/ai-search", post(ai_search))
        .nest_service("/", ServeDir::new("static"))
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
        tracing::info!("Seeding database with real Turkish restaurants...");
        let restaurants = vec![
            ("Nusr-Et Steakhouse Sandal Bedesteni", 41.0125, 28.9682, "https://www.nusr-et.com.tr/menu"),
            ("Zübeyir Ocakbaşı", 41.0368, 28.9800, "https://zubeyirocakbasi.com.tr/menu"),
            ("Hafiz Mustafa 1864", 41.0142, 28.9774, "https://www.hafizmustafa.com/menu/"),
            ("Karaköy Güllüoğlu", 41.0245, 28.9775, "https://www.karakoygulluoglu.com/menu"),
            ("Mikla Restaurant", 41.0345, 28.9814, "https://www.miklarestaurant.com/tr/menu/mikla-menu"),
            ("Bayramoğlu Döner", 41.0965, 29.0910, "https://www.bayramogludoner.com.tr/menu"),
            ("Çiya Sofrası", 40.9886, 29.0234, "https://ciya.com.tr/menu/"),
            ("Günaydın Kasap Steakhouse", 41.0165, 29.1305, "https://www.gunaydinet.com/menu"),
            ("Aspava Yıldız", 39.9075, 32.8620, "https://aspava.com.tr/menu"),
            ("7 Mehmet", 36.8835, 30.6580, "https://www.7mehmet.com/menu"),
        ];

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
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={}",
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

    // Extract the text from Gemini response and parse it as a JSON array of IDs
    let ai_text = gemini_response["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "Failed to get AI response text".into()))?
        .trim();

    // Remove markdown code blocks if present
    let cleaned_text = ai_text.replace("```json", "").replace("```", "").trim().to_string();

    let matching_ids: Vec<i64> = serde_json::from_str(&cleaned_text)
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, format!("AI returned invalid JSON: {}", cleaned_text)))?;

    Ok(Json(matching_ids))
}
